const express = require('express'),
    app = express(),
    passport = require('passport'),
    auth = require('./auth'),
    cookieParser = require('cookie-parser'),
    cookieSession = require('cookie-session'),
    WebSocket = require('ws'),
    path = require('path')



const socket = new WebSocket('ws://localhost:5005')
socket.onopen = function() {
  console.log("Соединение установлено.");
};

socket.onclose = function(event) {
  if (event.wasClean) {
    console.log('Соединение закрыто чисто');
  } else {
    console.log('Обрыв соединения'); // например, "убит" процесс сервера
  }
  console.log('Код: ' + event.code + ' причина: ' + event.reason);
};

socket.onmessage = function(event) {
  console.log("Получены данные " + event.data);
};

socket.onerror = function(error) {
  console.log("Ошибка " + error.message);
};

auth(passport)

app.use(passport.initialize())

app.use(cookieSession({
  name: 'sessionY',
  keys: ['123']
}))

app.use(cookieParser())


app.use(express.static('dist'))

app.use((req, res, next) => {
  if (!req.session.token) { 
    let indexOfStaticFilewsMiddlware = false

    app._router.stack.forEach((fn, index) => {
      if (fn.name === 'serveStatic')
      indexOfStaticFilewsMiddlware = index
    })

    if (indexOfStaticFilewsMiddlware !== false)
      app._router.stack.splice(indexOfStaticFilewsMiddlware, 1)
  }

  next()
})

app.get('/', (req, res) => {
  if (req.session.token) {
    res.cookie('token', req.session.token)
    res.end('<a href="/app">App</a>')
  } else {
    res.cookie('token', '')
    res.end('<a href="/auth/google">Log in</a>')
  
  }
})

app.get('/app', (req, res) => {
  if (req.session.token) {
     res.sendFile(path.resolve(__dirname, 'index.html'))
  } else {
    console.log('/app', req.session.token);
    res.cookie('token', '')
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
    req.session.token = req.user.token
    res.redirect('/')
  }
)

app.get('/logout', (req, res) => {
  console.log('logout')
  // console.log(req.session.passport.user.profile.emails[0].value)

  req.logout()
  req.session = null
  res.redirect('/')
})

app.get('/test', (req,res) => {
  res.cookie('token', req.session.token)

  res.json({
    req: JSON.stringify(req.headers, null, 2),
    res: JSON.stringify(res._headers, null, 2)})
})

app.get('/feedback/:msg', (req,res) => {
  // TODO: Check Token
  // Write to DB
  // Pass to WS-Server
  // WS-Server Broadcasts to authenticated users
  res.cookie('token', req.session.token)

  console.log(req.params)
  console.log(req.session.token)
  
  const socketMessage = {
    secret: 'xxx9924',
    body: req.params.msg,
    author: req.session.passport.user.profile.emails[0].value
  }

  socket.send(JSON.stringify(socketMessage))

  res.json({
    req: JSON.stringify(req.headers, null, 2),
    res: JSON.stringify(res._headers, null, 2)})
})

app.listen(5000, () => {
    console.log('Server is running on port 5000')
})