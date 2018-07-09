// create ws
// accept new authenticated users only from the http server (sign with secret key)
// accept sign ups for the broadcast messages from clients that are authenticated
// accept messages for broadcast only the the http server (sign with secret key)
// broadcast messages for the http server to signed up clients
// control expiration of tokens of authenticated users

const PORT = 5005

const fs = require('fs')
const http = require('http')
const WebSocket = require('ws')
const config = require('./config')

const authenticated_tokens = []

const server = new http.createServer()

const verifyClient = (info) => {
  if (info.req.headers.secret === config.ws.secret) {
    return true
  }

  const clientToken = info.req.headers['sec-websocket-protocol']

  if (clientToken && authenticated_tokens.includes(clientToken)) {
    // accept only authorized clients
    return true
  }
    
  return false
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
    console.log('received: %s', message)
    
    const messageJSON = JSON.parse(message)

    if (messageJSON.secret !== config.ws.secret) return
      // parse request from the http server

    if (messageJSON.action === 'token-add') {
      console.log('Added new token to.')
      authenticated_tokens.push(messageJSON.body)
    }

    if (messageJSON.action === 'feedback-add') {
      wss.broadcast(JSON.stringify({
        action: 'feedback-add',
        body: messageJSON.body,
        author: messageJSON.author
      }))
    }

    if (messageJSON.action === 'tag-add') {
      wss.broadcast(JSON.stringify({
        action: 'tag-add',
        body: messageJSON.body,
        author: messageJSON.author
      }))
    }

    if (messageJSON.action === 'tag-delete') {
      wss.broadcast(JSON.stringify({
        action: 'tag-delete',
        body: messageJSON.body,
        author: messageJSON.author
      }))
    }

  })
 
  console.log('A new connection to WS server is established.')
  ws.send('Connection to WS server is established.')
})

server.listen(PORT)
