const express = require('express'),
  app = express(),
  passport = require('passport'),
  auth = require('./auth'),
  cookieParser = require('cookie-parser'),
  cookieSession = require('cookie-session'),
  WebSocket = require('ws'),
  path = require('path'),
  config = require('./config'),
  fs = require('fs'),
  pg = require('pg')

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

// Give app only to authenticated users.
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
        action: 'add-token',
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
    req.body.tags.split(' ').forEach(tag => {
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

app.post('/api/tag', (req, res) => {
  if (!req.session.token) {
    return res.send(JSON.stringify({result: "error", body: "Access denied"}))
  }
  
  res.cookie('token', req.session.token)
  res.end(JSON.stringify({status: 200, result: "ok", body: "will broadcast"}))

  const serializedTags = {}

  if (req.body.tagName.length > 0) {
    req.body.tagName.split(' ').forEach(tag => {
      serializedTags[tag] = {}
      serializedTags[tag].author = req.author
      serializedTags[tag].timestamp = (new Date).toJSON()
    })
  }

  // TODO: Write to DB
  const tagsUpdated = Object.assign(
    {},
    dataFromFile[req.body.feedbackId].tags,
    serializedTags
  )

  dataFromFile[req.body.feedbackId].tags = tagsUpdated

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

app.delete('/api/tag', (req, res) => {
  if (!req.session.token) {
    return res.send(JSON.stringify({result: "error", body: "Access denied"}))
  }

  res.cookie('token', req.session.token)
  res.end(JSON.stringify({status: 200, result: "ok", body: "will broadcast"}))

  const { feedbackId, tagName } = req.body

  const tagList = dataFromFile[feedbackId].tags
  const updatedTagList = {}

  Object.keys(tagList).forEach(tag => {
    if (tag !== tagName)
      updatedTagList[tagName] = tagList[tagName]
  })

  dataFromFile[feedbackId].tags = updatedTagList

  const socketMessage = {
    action: 'tag-delete',
    body: req.body,
    author: req.author,
    secret: config.ws.secret
  }

  // TODO: check if socket is open
  socket.send(JSON.stringify(socketMessage))
})

app.get('/api/getdata', async(req, res) => {
  if (!req.session.token) {
    return res.send('{result:"error", body:"Access denied"}')
  }

  res.cookie('token', req.session.token)
  const data = await getAll()
  const dataParsed = []
  
  if (data === false) {
    return res.end(JSON.stringify({
      author: req.author,
      data: [],
      error: 'getAll() failed to fetch data from postgres'
    }))
  }

  data.forEach(entry => dataParsed.push(entry.entry))

  res.end(JSON.stringify({
    author: req.author,
    data: dataParsed
  }))
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

const getAll = async() => {
  const text = 'SELECT entry FROM public.feedbacks'
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

