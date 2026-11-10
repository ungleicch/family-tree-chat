// Real-time chat service via socket.io.
// Connects to port 3003. The Next.js frontend connects via:
//   io("/?XTransformPort=3003", { transports: ["websocket", "polling"] })
// Messages are also persisted to the DB by the Next.js API route (/api/messages),
// so this service only needs to broadcast — not store — chat messages.
//
// Auth: clients pass their session JWT in the `auth` field of the connection.
// We verify it with jsonwebtoken. (Same secret as the main app.)

import { createServer } from 'http'
import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import { resolveJwtSecret } from './lib/secrets'
import { resolveAllowedOrigins } from './lib/chat-origins'

let JWT_SECRET: string
try {
  JWT_SECRET = resolveJwtSecret()
} catch (error) {
  console.error('[chat] refusing to start:', error instanceof Error ? error.message : 'secret error')
  process.exit(1)
}

const allowed = resolveAllowedOrigins()
if (allowed.error) {
  console.error('[chat] refusing to start:', allowed.error)
  process.exit(1)
}

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: allowed.origins, credentials: true, methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

interface ChatUser {
  id: string
  email: string
  name: string | null
  role: string
}

interface ChatMessage {
  id: string
  content: string
  user: ChatUser
  timestamp: string
}

const onlineUsers = new Map<string, ChatUser>()

// Extract session token from either auth.token (explicit) or the ft_session cookie.
function extractToken(handshake: any): string | null {
  const auth = handshake.auth || {}
  if (auth.token && typeof auth.token === 'string') return auth.token
  // Cookie header
  const cookieHeader = handshake.headers?.cookie || handshake.request?.headers?.cookie
  if (!cookieHeader) return null
  const match = cookieHeader.match(/ft_session=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

io.engine.on('headers', headers => { headers['X-Family-Membership-Enforced'] = '1' })
async function currentMember(socket: any) {
  try {
    const response = await fetch('https://pitchblack.icu/api/auth/chat-access', {headers:{Authorization:'Bearer '+socket.data.membershipToken},signal:AbortSignal.timeout(3500)})
    if (response.ok) return true
  } catch {}
  socket.disconnect(true)
  return false
}
async function broadcastMembers(event: string, payload: any, except?: string) {
  for (const socket of io.sockets.sockets.values()) if (socket.id !== except && await currentMember(socket)) socket.emit(event,payload)
}
io.use(async (socket, next) => {
  const token = extractToken(socket.handshake)
  if (!token) {
    return next(new Error('no token'))
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any
    if (payload.purpose !== 'chat' || payload.access !== 'approved' || typeof payload.userId !== 'string' || typeof payload.email !== 'string') {
      return next(new Error('invalid token'))
    }
    socket.data.membershipToken = token
    if (!await currentMember(socket)) return next(new Error('family membership required'))
    ;(socket as any).user = {
      id: payload.userId,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    } as ChatUser
    next()
  } catch (err) {
    next(new Error('invalid token'))
  }
})

io.on('connection', async (socket) => {
  const user = (socket as any).user as ChatUser
  if (!user) {
    socket.disconnect(true)
    return
  }

  onlineUsers.set(user.id, user)
  console.log(`[chat] user ${user.id} connected — online: ${onlineUsers.size}`)

  socket.emit('online-users', Array.from(onlineUsers.values()))
  await broadcastMembers('user-online', user)

  socket.on('send-message', async (payload: { content: string }) => {
    if (!await currentMember(socket)) return
    if (!payload || typeof payload.content !== 'string' || !payload.content.trim()) return
    if (payload.content.length > 2000) return

    // The actual persistence happens in the Next.js /api/messages POST.
    // Here we just broadcast the message to everyone (including the sender
    // for confirmation). The client should also persist via /api/messages.
    const msg: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      content: payload.content.trim(),
      user,
      timestamp: new Date().toISOString(),
    }
    await broadcastMembers('chat-message', msg)
  })

  socket.on('typing', async (isTyping: boolean) => {
    if (!await currentMember(socket)) return
    await broadcastMembers('user-typing', { user, isTyping }, socket.id)
  })

  const membershipTimer=setInterval(()=>{void currentMember(socket)},10000)
  socket.on('disconnect', () => {
    clearInterval(membershipTimer)
    onlineUsers.delete(user.id)
    console.log(`[chat] user ${user.id} disconnected — online: ${onlineUsers.size}`)
    void broadcastMembers('user-offline', user)
  })

  socket.on('error', (err) => {
    console.error(`[chat] socket error for user ${user.id}`)
  })
})

const PORT = Number(process.env.PORT || 3003)
httpServer.listen(PORT, () => {
  console.log(`[chat] Chat service running on port ${PORT}`)
})

process.on('SIGTERM', () => httpServer.close(() => process.exit(0)))
process.on('SIGINT', () => httpServer.close(() => process.exit(0)))
