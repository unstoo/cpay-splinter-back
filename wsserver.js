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


const fs = require('fs')
const http = require('http')
const WebSocket = require('ws')
const config = require('./config')

const authenticated_tokens = []

const server = new http.createServer()

const verifyClient = (info) => {
  if (info.req.headers.secret === config.ws.secret)
    return true

  const clientToken = info.req.headers['sec-websocket-protocol']

  if (clientToken) {
    // accept only authorized clients
    if (authenticated_tokens.includes(clientToken)) {
      console.log('known clientToken: ', clientToken)
      return true
    }
    
    console.log('unknown clientToken: ', clientToken)
    return false
  }

}
const wss = new WebSocket.Server({ server, verifyClient })

wss.broadcast = function broadcast(data) {
  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  })
} 

wss.on('connection', function connection(ws) {

  ws.on('message', function incoming(message) {
    const messageJSON = JSON.parse(message)
    console.log('received: %s', message)
    if (messageJSON.secret === config.ws.secret) {
      // parse request from the http server

      if (messageJSON.action === 'add-token') {
        console.log('added new token to: ', JSON.stringify(authenticated_tokens, null, 2))
        authenticated_tokens.push(messageJSON.body)
        
      }

      if (messageJSON.action === 'broadcast') {
        wss.broadcast(JSON.stringify({
          type: 'broadcast',
          body: messageJSON.body
        }))
      }
    }
  })
 
  ws.send('Connection to WS Server is established.')
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