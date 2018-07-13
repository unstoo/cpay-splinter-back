const express = require('express'),
  app = express(),
  passport = require('passport'),
  auth = require('./auth'),
  cookieParser = require('cookie-parser'),
  cookieSession = require('cookie-session'),
  WebSocket = require('ws'),
  path = require('path'),
  config = require('./backend-config'),
  fs = require('fs'),
  pg = require('pg')

const webpack = require("webpack");
const webpackConfig = require("./webpack.config");
const compiler = webpack(webpackConfig);

app.use(
  require("webpack-dev-middleware")(compiler, {
      noInfo: true,
      publicPath: webpackConfig.output.publicPath
  })
)

app.use(require("webpack-hot-middleware")(compiler))


const pool = new pg.Pool({
  user: config.pg.user,
  host: config.pg.host,
  database: config.pg.database,
  password: config.pg.password,
  port: config.pg.port
})

// const dataFromFile = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'data.txt'), 'utf8'))

const socket = initSocket()

auth(passport)
 
app.use(passport.initialize())

app.use(cookieSession({
  name: 'sessionY',
  keys: ['123']
}))

app.use(cookieParser())

app.use((req, res, next) => {
  if (req.session.passport)
    req.author = req.session.passport.user.profile.emails[0].value
  
    next()
})

app.use(express.json())

app.use((req, res, next) => {
  console.log(`${req.method}::path: ${req.path}`)
  console.log(`session ${req.session.token}`)
  console.log(`body ${JSON.stringify(req.body)}`)
  next()
})

app.get('/', (req, res) => {
  if (req.session.token) {
    res.cookie('token', req.session.token)
    res.sendFile(path.resolve(__dirname, 'dist/index.html'))
  } else {
    console.log(req.query);
    if (req.query.email === '') {
      res.end('<html><span>Use @cryptopay.me email to <a href="/auth/google">Log in</a></span></html>')
      return
    }
    res.cookie('token', '')
    res.end('<a href="/auth/google">Log in</a>')
  }
})

// Serve app only to authenticated users
app.get('/app.bundle.js', (req, res) => {
  if (req.session.token) {
    res.cookie('token', req.session.token)  
    res.sendFile(path.resolve(__dirname, 'dist/app.bundle.js'))
  } else {
    console.log('No session -- no static files.');
    res.redirect('/')
  } 
})

app.get('/auth/google', passport.authenticate('google', {
  scope: [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email'
  ]
}))

app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    console.log('Google login by: ', req.user.profile.emails[0].value)

    if (req.user.profile.emails[0].value.includes('@cryptopay.me') === false) {
      res.redirect('/?email')
    } else {
      req.session.token = req.user.token

      const socketMessage = {
        action: 'token-add',
        body: req.session.token,
        secret: config.ws.secret
      }

      // TODO: check if socket is open
      socket.send(JSON.stringify(socketMessage))

      res.redirect('/')
    }
  }
)

app.get('/logout', (req, res) => {
  console.log('logout')
  // console.log(req.session.passport.user.profile.emails[0].value)

  req.logout()
  req.session = null
  res.redirect('/')
})

app.post('/api/feedback', async(req, res) => {
  if (!req.session.token) {
    res.end(JSON.stringify({result: "error", body: "Access denied"}))
    return
  }
  
  res.cookie('token', req.session.token)
  
  // TODO: Write to DB
  const feedbackId = await getLastId()
  if (feedbackId === false) {
    res.end(JSON.stringify({result: "error", body: "Couldn't get last id from postgres"}))
    return
  }

  req.body.id = parseInt(feedbackId) + 1
  req.body.name = req.author
  req.body.date = (new Date).toJSON().split('T')[0]

  const serializedTags = {}

  if (req.body.tags !== '') {
    req.body.tags.split(',').forEach(tag => {
      serializedTags[tag] = {}
      serializedTags[tag].author = req.author
      serializedTags[tag].timestamp = (new Date).toJSON()
    })
  }

  req.body.tags = serializedTags

  const result = await insertFeedback(req.body)

  if (result === false) {
    res.end(JSON.stringify({result: "error", body: "Couldn't insert into postgres"}))
    return
  }

  res.end(JSON.stringify({status: 200, result: "ok", body: "will broadcast"}))

  const socketMessage = {
    action: 'feedback-add',
    body: req.body,
    author: req.author,
    secret: config.ws.secret
  }

  // TODO: check if socket is open
  socket.send(JSON.stringify(socketMessage))
})

app.post('/api/tag', async(req, res) => {
  if (!req.session.token) {
    return res.send(JSON.stringify({result: "error", body: "Access denied"}))
  }
  res.cookie('token', req.session.token)
  
  const feedback = await getFeedbackById(req.body.feedbackId)
  
  if (feedback === false) {
    res.end(JSON.stringify({status: 500, result: "error", body: "Couldn't select feedback from postgres"}))
    return
  }
  
  const serializedTags = {}
  
  if (req.body.tagName.length > 0) {
    req.body.tagName.split(',').forEach(tag => {
      tag = tag.trim()
      serializedTags[tag] = {}
      serializedTags[tag].author = req.author
      serializedTags[tag].timestamp = (new Date).toJSON()
    })
  }

  Object.keys(serializedTags).forEach(async(tagName) => {
    const r = await insertTagIntoTagsByCategories(tagName)
  })
  
  // Don't update existing tags, with new duplicate tags
  const tagsUpdated = Object.assign(
    {},
    serializedTags,
    feedback.tags
  )
  
  feedback.tags = tagsUpdated

  const updateResult = await updateFeedback(feedback)
  
  if (updateResult === false) {
    res.end(JSON.stringify({status: 500, result: "error", body: "Couldn't update feedback in postgres"}))
    return
  }

  delete req.body.tagName

  req.body.tags = serializedTags

  const socketMessage = {
    action: 'tag-add',
    body: req.body,
    author: req.author,
    secret: config.ws.secret
  }

  // TODO: check if socket is open
  socket.send(JSON.stringify(socketMessage))
})

app.delete('/api/tag', async(req, res) => {
  if (!req.session.token) {
    return res.send(JSON.stringify({result: "error", body: "Access denied"}))
  }
  res.cookie('token', req.session.token)

  const { feedbackId, tagName } = req.body



  const feedback = await getFeedbackById(feedbackId)

  if (feedback === false) {
    res.end(JSON.stringify({status: 500, result: "error", body: "Couldn't select feedback from postgres"}))
    return
  }

  const updatedTagList = {}

  Object.keys(feedback.tags).forEach(tag => {
    if (tag !== tagName)
      updatedTagList[tag] = feedback.tags[tag]
  })

  feedback.tags = updatedTagList

  const updateResult = await updateFeedback(feedback)

  if (updateResult === false) {
    res.end(JSON.stringify({status: 500, result: "error", body: "Couldn't update feedback in postgres"}))
    return
  }

  const count = await countTagNameAppearances(tagName)
  
  if (count === 0) {
    let res = await deleteTagFromTagCategory(tagName)

    const socketMessage = {
      action: 'tag-purge',
      body: { tagName },
      author: req.author,
      secret: config.ws.secret
    }

    socket.send(JSON.stringify(socketMessage))
  }

  res.end(JSON.stringify({status: 200, result: "ok", body: "Successfully removed tag; Will broadcast"}))

  const socketMessage = {
    action: 'tag-delete',
    body: req.body,
    author: req.author,
    secret: config.ws.secret
  }

  // TODO: check if socket is open
  socket.send(JSON.stringify(socketMessage))
})

app.patch('/api/tag', async(req, res) => {
  if (!req.session.token) {
    return res.send('{result:"error", body:"Access denied"}')
  }
  res.cookie('token', req.session.token)

  const { currentTagName, newTagName } = req.body
  if (!currentTagName || !newTagName) {
    return res.send('{result:"error", body:"Missing argument(s)"}')
  }

  // select id, entry where @> { "tags": { [currentTagName]: {} } }
  const feedbacks = await selelctAllFeedbacksWhereTagsIncludeTagName(currentTagName)

  feedbacks.forEach(feedback => {
    const feedbackHasTagNameToBeUpdated = Object.keys(feedback.entry.tags).includes(currentTagName)
    let temp = {}
    if (feedbackHasTagNameToBeUpdated) {
      temp = feedback.entry.tags[currentTagName]
      delete feedback.entry.tags[currentTagName]
      feedback.entry.tags[newTagName] = temp
    }
  })

  let feedbackUpdateErrorFlag = false

  let index = 0
  while (index < feedbacks.length) {
    let result = await updateFeedback(feedbacks[index].entry)
    if (result === false) {
      feedbackUpdateErrorFlag = true
    }
    index += 1
  }

  if (feedbackUpdateErrorFlag) {
    throw new Error('ZHOPA DB')
    // TODO: update all feedbacks otherwise rollback all changes
  }

  // 1) check if the currentTagName was purged from Feedbacks
  const count = await countTagNameAppearances(currentTagName)
  let bp = true
  if (count !== 0)
    // NOT ALL currenTagNames were updated in postgres as supposed
    throw new Error('WTOTO POWLO NE TAK -- ZHOPA ALERT')
  
  // 2) delete currentTagName from tag_category
  const removalResult = await deleteTagFromTagCategory(currentTagName)
  
  if (removalResult === false)
    throw new Error('SLU4iLAS HERNJA. RAZBERISJ DZHEDAJ')

  // 3) insert newTagName to tag_category
  const insertionResult = await insertTagIntoTagsByCategories(newTagName)

  if (insertionResult === false)
    throw new Error('OPC -- POPEC NASTIG TEBJA')


  // broadcast tag currentTagName renamed to newTagName
  const socketMessage = {
    action: 'tag-rename',
    body: req.body,
    author: req.author,
    secret: config.ws.secret
  }

  res.end(JSON.stringify({status: 200, result: "ok", body: "Will broadcast the amendmend"}))

  // TODO: check if socket is open
  socket.send(JSON.stringify(socketMessage))
})

app.get('/api/getdata', async(req, res) => {
  if (!req.session.token) {
    return res.send('{result:"error", body:"Access denied"}')
  }

  res.cookie('token', req.session.token)
  const data = await selectAllFeedbacks()
  
  if (data === false) {
    return res.end(JSON.stringify({
      author: req.author,
      data: [],
      error: 'selectAllFeedbacks() failed to fetch data from postgres'
    }))
  }

  const tagsCategory = await selectAllTagCategory()

  if (tagsCategory === false) {
    return res.end(JSON.stringify({
      author: req.author,
      data: [],
      error: 'selectAllTagCategory() failed to fetch data from postgres'
    }))
  }

  const tagCategoryParsed = {}
  tagsCategory.forEach(row => tagCategoryParsed[row.tag] = row.category)
  
  const dataParsed = []
  data.forEach(entry => dataParsed.push(entry.entry))

  res.end(JSON.stringify({
    author: req.author,
    data: dataParsed,
    tagsByCategory: tagCategoryParsed
  }))
})

app.post('/api/category', async(req, res) => {
  if (!req.session.token) {
    return res.send('{result:"error", body:"Access denied"}')
  }

  res.cookie('token', req.session.token)

  const updateResult = await updateTagsCategory(req.body.tagName, req.body.categoryName)

   if (updateResult === false) {
    res.end(JSON.stringify({status: 500, result: "error", body: "Couldn't update tag's category in postgres"}))
    return
  }

  const socketMessage = {
    action: 'category-set',
    body: req.body,
    author: req.author,
    secret: config.ws.secret
  }

  res.end(JSON.stringify({status: 200, result: "ok", body: "Will broadcast the amendmend"}))

  // TODO: check if socket is open
  socket.send(JSON.stringify(socketMessage))
})

app.listen(5000, () => {
    console.log('Server is running on port 5000')
})

function initSocket() {
  const socket = new WebSocket('ws://localhost:5005', {
    headers: {
      secret: config.ws.secret
    }
  })

  socket.onopen = function() {
    console.log("Соединение установлено.");
  }

  socket.onclose = function(event) {
    if (event.wasClean) {
      console.log('Соединение закрыто чисто')
    } else {
      console.log('Обрыв соединения') // например, "убит" процесс сервера
    }
    console.log('Код: ' + event.code + ' причина: ' + event.reason)
  }

  socket.onmessage = function(event) {
    console.log("Получены данные " + event.data);
  }

  socket.onerror = function(error) {
    console.log("Ошибка " + error.message)
  }

  return socket
}

const selectAllFeedbacks = async() => {
  const text = 'SELECT entry FROM public.feedbacks order by id asc'
  let result
  try {
    result = await pool.query(text)
  } catch(err) {
    console.log(err.stack)
    return false
  }
  return result.rows
}

const selectAllTagCategory = async() => {
  const text = 'SELECT tag, category FROM public.tag_category order by tag desc'
  let result
  try {
    result = await pool.query(text)
  } catch(err) {
    console.log(err.stack)
    return false
  }
  return result.rows
}

const insertFeedback = async(feedback) => {
  const text = 'INSERT INTO public.feedbacks(entry) VALUES($1) RETURNING *'
  const values = [JSON.stringify(feedback)]

  let result
  try {
    result = await pool.query(text, values)
  } catch(err) {
    console.log(err.stack)
    return false
  }

  return result
}

const getLastId = async() => { 
  let id = false
  const text = 'select id from feedbacks order by id desc limit 1'
  try {
    const result = await pool.query(text)
    id = result.rows[0].id
  } catch(err) {
    console.log(err.stack)
  }
  return id
}

const getFeedbackById = async(id) => { 
  let entry = false
  const text = 'select entry from feedbacks where id = $1'
  const values = [id]
  try {
    const result = await pool.query(text, values)
    entry = result.rows[0].entry
  } catch(err) {
    console.log(err.stack)
  }
  return entry
}

const updateFeedback = async(feedback) => { 
  let result = false
  const text = "UPDATE feedbacks SET entry = $1 WHERE id = $2 "
  const values = [JSON.stringify(feedback), feedback.id]
  try {
    result = await pool.query(text, values)
  } catch(err) {
    console.log(err.stack)
  }
  return result
}

const insertTagIntoTagsByCategories = async(tagName) => {
  let result = false
  const checkForExistence = "SELECT * FROM tag_category WHERE tag = $1"
  const valuesForExistence = [tagName]
  try {
    result = await pool.query(checkForExistence, valuesForExistence)
    if (result.rows.length !== 0) {
      return true
    }
  } catch(err) {
    console.log(JSON.stringify(err, null, 2))
  } 

  const text = "INSERT INTO tag_category (tag, category) VALUES ($1, $2) RETURNING *"
  const values = [tagName, 'none']
  try {
    result = await pool.query(text, values)
    result = result.rows[0]
  } catch(err) {
    console.log(JSON.stringify(err, null, 2))
    if (err.code == 23505) {
      result = true
    }
  } 
}

const updateTagsCategory = async(tagName, categoryName) => {
  let result = false
  const text = 'UPDATE tag_category SET category = $2 WHERE tag = $1 '
  const values = [tagName, categoryName]
  try {
    result = await pool.query(text, values)
  } catch(err) {
    console.log(err.stack)
  }
  return result
}

const countTagNameAppearances = async(tagName) => {
  let result
  const text = `select * from feedbacks where entry @> $1`
  const value = [JSON.stringify({"tags": {[tagName]: {}}})]
  try {
    result = await pool.query(text, value)
    return result.rows.length
  } catch(err) {
    console.log(err.stack)
    return false
  }
}

const selelctAllFeedbacksWhereTagsIncludeTagName = async(tagName) => {
  let result
  const text = `select * from feedbacks where entry @> $1`
  const value = [JSON.stringify({"tags": {[tagName]: {}}})]
  try {
    result = await pool.query(text, value)
    return result.rows
  } catch(err) {
    console.log(err.stack)
    return false
  }
}

const deleteTagFromTagCategory = async(tagName) => {
  let result
  const text = `delete from tag_category where tag = $1`
  const value = [tagName]
  try {
    const { rowCount } = await pool.query(text, value)
    return { rowCount }
  } catch(err) {
    console.log(err.stack)
    return false
  }
}
