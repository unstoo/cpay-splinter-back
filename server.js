const express = require('express'),
    app = express(),
    passport = require('passport'),
    auth = require('./auth'),
    cookieParser = require('cookie-parser'),
    cookieSession = require('cookie-session'),
    WebSocket = require('ws'),
    path = require('path'),
    config = require('./config')

const socket = initSocket()

auth(passport)
 
app.use(passport.initialize())

app.use(cookieSession({
  name: 'sessionY',
  keys: ['123']
}))
 
app.use(cookieParser())

app.use((req, res, next) => {
  console.log(`${req.method}::path: ${req.path}`)
  console.log(`session ${req.session.token}`);
  next()
})

app.get('/', (req, res) => {
  if (req.session.token) {
    res.cookie('token', req.session.token)
    res.sendFile(path.resolve(__dirname, 'dist/index.html'))
  } else {
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
      res.end('Use @cryptopay.me email to login')
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

app.get('/api/:msg', (req,res) => {
  if (!req.session.token) {
    res.send('{"status": "error", body":"Access denied."}')
    return
  }
  
  res.cookie('token', req.session.token)
  res.send('{"status": "ok", "body":"will broadcast"}')

  const socketMessage = {
    action: 'broadcast',
    body: req.params.msg,
    author: req.session.passport.user.profile.emails[0].value,
    secret: config.ws.secret
  }

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
      console.log('Соединение закрыто чисто');
    } else {
      console.log('Обрыв соединения'); // например, "убит" процесс сервера
    }
    console.log('Код: ' + event.code + ' причина: ' + event.reason);
  }

  socket.onmessage = function(event) {
    console.log("Получены данные " + event.data);
  }

  socket.onerror = function(error) {
    console.log("Ошибка " + error.message);
  }

  return socket
}