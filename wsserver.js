// create ws
// accept new authenticated users only from the http server (sign with secret key)
// accept sign ups for the broadcast messages from clients that are authenticated
// accept messages for broadcast only the the http server (sign with secret key)
// broadcast messages for the http server to signed up clients
// control expiration of tokens of authenticated users

const PORT = 5005
const ADD_USER = '/auth'
const REMOVE_USER = '/deauth'
const ADD_FEEDBACK = '/feedback'
const ADD_TAG = '/tag/add'
const REMOVE_TAG = '/tag/remove'
const SIGN_UP = '/signup'

const authenticated_users = {
  // token : valid until this time
}

const fs = require('fs')
const http = require('http')
const WebSocket = require('ws')
 
const server = new http.createServer()
const wss = new WebSocket.Server({ server })

wss.broadcast = function broadcast(data) {
  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  })
}

wss.on('connection', function connection(ws) {
  console.log('received: %s', ws)

  ws.on('message', function incoming(message) {
    const messageJSON = JSON.parse(message)
    delete messageJSON.secret
    console.log('received: %s', messageJSON)
    wss.broadcast(JSON.stringify(messageJSON))
  })
 
  ws.send('Connection to WS Server.')
})

wss.on('open', function open() {
  // HTTP Server must first register the user
  ws.send('Open a WS Server.')
})
 
server.listen(PORT)

function isTokenValid({ token, token_list }) {
  if (!token_list[token]) return false
  const expiry = token_list[token]
  if (expiry < Date.now) {
    delete token_list[token]
    return false
  }

  return true
}