const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Room Management
class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.archivedRooms = new Map(); // Store inactive rooms for later retrieval
    
    // Room cleanup interval (check for inactive rooms every 30 minutes)
    setInterval(() => this.cleanupInactiveRooms(), 30 * 60 * 1000);
  }
  
  // Create a new room
  createRoom(roomId, creatorName) {
    const now = Date.now();
    
    // Check if room already exists
    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId);
    }
    
    // Check if room was archived
    if (this.archivedRooms.has(roomId)) {
      const archivedRoom = this.archivedRooms.get(roomId);
      this.archivedRooms.delete(roomId);
      archivedRoom.lastActivity = now;
      archivedRoom.isActive = true;
      this.rooms.set(roomId, archivedRoom);
      console.log(`Room ${roomId} restored from archive`);
      return archivedRoom;
    }
    
    // Create new room object
    const newRoom = {
      id: roomId,
      creator: creatorName,
      createdAt: now,
      lastActivity: now,
      isActive: true,
      users: new Map(),
      featuredPoll: {
        id: 'featured',
        question: 'Cats vs Dogs',
        options: [
          { id: 1, text: 'Cats', votes: 12 },
          { id: 2, text: 'Dogs', votes: 15 }
        ],
        totalVotes: 27
      },
      polls: [
        {
          id: 1,
          question: 'What is your favorite programming language?',
          options: [
            { id: 1, text: 'JavaScript', votes: 0 },
            { id: 2, text: 'Python', votes: 0 },
            { id: 3, text: 'Java', votes: 0 },
            { id: 4, text: 'C#', votes: 0 }
          ],
          totalVotes: 0,
          createdBy: creatorName,
          createdAt: now
        }
      ],
      votingEnabled: true,
      timerEndTime: now + (60 * 1000), // 60 seconds from now
      messages: []
    };
    
    this.rooms.set(roomId, newRoom);
    console.log(`Room ${roomId} created by ${creatorName}`);
    return newRoom;
  }
  
  // Get a room by ID
  getRoom(roomId) {
    return this.rooms.get(roomId);
  }
  
  // Add a user to a room
  addUserToRoom(roomId, userId, userData) {
    const room = this.getRoom(roomId);
    if (!room) return null;
    
    room.lastActivity = Date.now();
    room.users.set(userId, {
      ...userData,
      joinedAt: Date.now()
    });
    
    return room;
  }
  
  // Remove a user from a room
  removeUserFromRoom(roomId, userId) {
    const room = this.getRoom(roomId);
    if (!room) return false;
    
    const result = room.users.delete(userId);
    
    // If room is empty, mark for potential archiving
    if (room.users.size === 0) {
      room.lastActivity = Date.now();
      room.isActive = false;
    }
    
    return result;
  }
  
  // Get users in a room
  getUsersInRoom(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return [];
    
    // Convert the Map to an array of user objects
    // Omit sensitive data like socket IDs
    return Array.from(room.users.entries()).map(([_, userData]) => ({
      username: userData.username,
      isAdmin: userData.isAdmin,
      joinedAt: userData.joinedAt
    }));
  }
  
  // Add a poll to a room
  addPollToRoom(roomId, pollData) {
    const room = this.getRoom(roomId);
    if (!room) return null;
    
    room.lastActivity = Date.now();
    
    // Generate a unique poll ID
    const pollId = room.polls.length > 0 
      ? Math.max(...room.polls.map(p => p.id)) + 1 
      : 1;
    
    const newPoll = {
      id: pollId,
      question: pollData.question,
      options: pollData.options.map((text, idx) => ({
        id: idx + 1,
        text,
        votes: 0
      })),
      totalVotes: 0,
      createdBy: pollData.createdBy || 'Anonymous',
      createdAt: Date.now()
    };
    
    room.polls.push(newPoll);
    return newPoll;
  }
  
  // Register a vote on a poll
  addVoteToPoll(roomId, pollId, optionId, userId, userData) {
    const room = this.getRoom(roomId);
    if (!room || !room.votingEnabled) return null;
    
    room.lastActivity = Date.now();
    
    // Handle featured poll separately
    if (pollId === 'featured') {
      const option = room.featuredPoll.options.find(opt => opt.id === optionId);
      if (option) {
        option.votes += 1;
        room.featuredPoll.totalVotes = room.featuredPoll.options.reduce(
          (sum, opt) => sum + opt.votes, 0
        );
        
        // Track who voted with additional metadata
        if (!room.featuredPoll.voters) {
          room.featuredPoll.voters = new Map();
        }
        
        // Store vote data with timestamp and user info
        room.featuredPoll.voters.set(userId, {
          optionId,
          timestamp: Date.now(),
          username: userData?.username || 'Anonymous',
          userAgent: userData?.userAgent
        });
        
        // Also store the last vote for animation purposes
        room.featuredPoll.lastVote = {
          optionId,
          username: userData?.username || 'Anonymous',
          timestamp: Date.now()
        };
        
        return {
          poll: room.featuredPoll,
          type: 'featured',
          voter: userData?.username || 'Anonymous'
        };
      }
      return null;
    }
    
    // Regular polls
    const poll = room.polls.find(p => p.id === pollId);
    if (!poll) return null;
    
    const option = poll.options.find(opt => opt.id === optionId);
    if (!option) return null;
    
    option.votes += 1;
    poll.totalVotes += 1;
    
    // Track who voted with additional metadata
    if (!poll.voters) {
      poll.voters = new Map();
    }
    
    // Store vote data with timestamp and user info
    poll.voters.set(userId, {
      optionId,
      timestamp: Date.now(),
      username: userData?.username || 'Anonymous',
      userAgent: userData?.userAgent
    });
    
    // Store the last vote for animation purposes
    poll.lastVote = {
      optionId,
      username: userData?.username || 'Anonymous',
      timestamp: Date.now()
    };
    
    return {
      poll,
      type: 'regular',
      voter: userData?.username || 'Anonymous'
    };
  }
  
  // Close voting in a room
  closeVoting(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return false;
    
    room.votingEnabled = false;
    room.lastActivity = Date.now();
    
    return true;
  }
  
  // Reopen voting in a room
  reopenVoting(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return false;
    
    room.votingEnabled = true;
    room.timerEndTime = Date.now() + (60 * 1000);
    room.lastActivity = Date.now();
    
    return true;
  }
  
  // Clean up inactive rooms (archive rooms inactive for more than 24 hours)
  cleanupInactiveRooms() {
    const now = Date.now();
    const inactivityThreshold = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [roomId, room] of this.rooms.entries()) {
      if (!room.isActive && (now - room.lastActivity) > inactivityThreshold) {
        this.archivedRooms.set(roomId, room);
        this.rooms.delete(roomId);
        console.log(`Room ${roomId} archived due to inactivity`);
      }
    }
    
    // Clean very old archived rooms (older than 30 days)
    const archiveThreshold = 30 * 24 * 60 * 60 * 1000; // 30 days
    for (const [roomId, room] of this.archivedRooms.entries()) {
      if ((now - room.lastActivity) > archiveThreshold) {
        this.archivedRooms.delete(roomId);
        console.log(`Room ${roomId} permanently deleted from archive`);
      }
    }
  }
  
  // Get all active rooms
  getActiveRooms() {
    return Array.from(this.rooms.values())
      .filter(room => room.isActive)
      .map(room => ({
        id: room.id,
        creator: room.creator,
        userCount: room.users.size,
        pollCount: room.polls.length,
        createdAt: room.createdAt
      }));
  }
  
  // Get room stats
  getStats() {
    return {
      activeRooms: this.rooms.size,
      archivedRooms: this.archivedRooms.size,
      totalUsers: Array.from(this.rooms.values())
        .reduce((count, room) => count + room.users.size, 0),
      totalPolls: Array.from(this.rooms.values())
        .reduce((count, room) => count + room.polls.length, 0)
    };
  }
  
  // Add a method to get vote statistics for a room
  getVoteStats(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return null;
    
    // Count featured poll votes
    const featuredVotes = room.featuredPoll.options.reduce((sum, opt) => sum + opt.votes, 0);
    
    // Count regular poll votes
    const regularVotes = room.polls.reduce((sum, poll) => 
      sum + poll.options.reduce((pollSum, opt) => pollSum + opt.votes, 0), 0);
    
    // Get unique voters across all polls
    const uniqueVoters = new Set();
    
    // Add featured poll voters
    if (room.featuredPoll.voters) {
      for (const userId of room.featuredPoll.voters.keys()) {
        uniqueVoters.add(userId);
      }
    }
    
    // Add regular poll voters
    for (const poll of room.polls) {
      if (poll.voters) {
        for (const userId of poll.voters.keys()) {
          uniqueVoters.add(userId);
        }
      }
    }
    
    return {
      roomId: room.id,
      featuredVotes,
      regularVotes,
      totalVotes: featuredVotes + regularVotes,
      uniqueVoters: uniqueVoters.size,
      pollCount: room.polls.length + 1 // +1 for featured poll
    };
  }
}

// Initialize room manager
const roomManager = new RoomManager();

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Join a room
  socket.on('joinRoom', ({ roomId, username }) => {
    if (!roomId || !username) {
      socket.emit('error', { message: 'Room ID and username are required' });
      return;
    }
    
    // Join the socket room
    socket.join(roomId);
    
    // Get or create the room
    const room = roomManager.createRoom(roomId, username);
    
    // Add user to room
    roomManager.addUserToRoom(roomId, socket.id, { 
      username,
      isAdmin: username === room.creator
    });
    
    // Send room data to user
    socket.emit('roomData', {
      roomId: room.id,
      creator: room.creator,
      featuredPoll: room.featuredPoll,
      polls: room.polls,
      userCount: room.users.size,
      votingEnabled: room.votingEnabled,
      timerEndTime: room.timerEndTime
    });
    
    // Broadcast to others that user joined
    socket.to(roomId).emit('userJoined', {
      username,
      userCount: room.users.size
    });
    
    console.log(`${username} joined room ${roomId}`);
  });
  
  // Switch rooms
  socket.on('switchRoom', ({ currentRoomId, newRoomId, username }) => {
    if (!currentRoomId || !newRoomId || !username) {
      socket.emit('error', { message: 'Current room ID, new room ID, and username are required' });
      return;
    }
    
    const currentRoomObj = roomManager.getRoom(currentRoomId);
    if (currentRoomObj) {
      const userData = currentRoomObj.users.get(socket.id);
      
      // Leave current room
      roomManager.removeUserFromRoom(currentRoomId, socket.id);
      socket.leave(currentRoomId);
      
      // Notify others that user left current room
      socket.to(currentRoomId).emit('userLeft', {
        username: userData ? userData.username : username,
        userCount: currentRoomObj.users.size
      });
      
      console.log(`${username} left room ${currentRoomId}`);
    }
    
    // Join new room
    socket.join(newRoomId);
    
    // Get or create the new room
    const newRoom = roomManager.createRoom(newRoomId, username);
    
    // Add user to new room
    roomManager.addUserToRoom(newRoomId, socket.id, { 
      username,
      isAdmin: username === newRoom.creator
    });
    
    // Send new room data to user
    socket.emit('roomData', {
      roomId: newRoom.id,
      creator: newRoom.creator,
      featuredPoll: newRoom.featuredPoll,
      polls: newRoom.polls,
      userCount: newRoom.users.size,
      votingEnabled: newRoom.votingEnabled,
      timerEndTime: newRoom.timerEndTime
    });
    
    // Broadcast to others in new room that user joined
    socket.to(newRoomId).emit('userJoined', {
      username,
      userCount: newRoom.users.size
    });
    
    console.log(`${username} switched to room ${newRoomId}`);
  });
  
  // Leave a room
  socket.on('leaveRoom', ({ roomId }) => {
    if (!roomId) return;
    
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    
    const userData = room.users.get(socket.id);
    if (!userData) return;
    
    // Remove user from room
    roomManager.removeUserFromRoom(roomId, socket.id);
    socket.leave(roomId);
    
    // Notify others that user left
    socket.to(roomId).emit('userLeft', {
      username: userData.username,
      userCount: room.users.size
    });
    
    console.log(`${userData.username} left room ${roomId}`);
  });
  
  // Cast vote for featured poll
  socket.on('voteFeaturedPoll', ({ roomId, optionId }) => {
    if (!roomId || !optionId) {
      socket.emit('error', { message: 'Room ID and option ID are required' });
      return;
    }
    
    const room = roomManager.getRoom(roomId);
    if (!room || !room.votingEnabled) {
      socket.emit('error', { message: 'Voting is disabled in this room' });
      return;
    }
    
    const userData = room.users.get(socket.id);
    if (!userData) {
      socket.emit('error', { message: 'User not found in room' });
      return;
    }
    
    // Check if user already voted on this poll
    if (room.featuredPoll.voters && room.featuredPoll.voters.has(socket.id)) {
      socket.emit('error', { message: 'You have already voted on this poll' });
      return;
    }
    
    // Record the vote with extra metadata
    const voteResult = roomManager.addVoteToPoll(
      roomId, 
      'featured', 
      optionId, 
      socket.id, 
      {
        ...userData,
        userAgent: socket.handshake.headers['user-agent']
      }
    );
    
    if (!voteResult) {
      socket.emit('error', { message: 'Failed to record vote' });
      return;
    }
    
    // Broadcast updated poll to everyone in the room
    io.to(roomId).emit('featuredPollUpdated', voteResult.poll);
    
    // Also broadcast a vote event with info about who voted
    io.to(roomId).emit('voteReceived', {
      pollId: 'featured',
      pollType: 'featured',
      optionId: optionId,
      voter: userData.username,
      timestamp: Date.now()
    });
    
    // Send acknowledgment to the voter
    socket.emit('voteRecorded', {
      pollId: 'featured',
      optionId: optionId,
      success: true
    });
    
    console.log(`Vote cast in featured poll in room ${roomId} by ${userData.username} for option ${optionId}`);
  });
  
  // Cast vote for regular poll
  socket.on('votePoll', ({ roomId, pollId, optionId }) => {
    if (!roomId || !pollId || !optionId) {
      socket.emit('error', { message: 'Room ID, poll ID, and option ID are required' });
      return;
    }
    
    const room = roomManager.getRoom(roomId);
    if (!room || !room.votingEnabled) {
      socket.emit('error', { message: 'Voting is disabled in this room' });
      return;
    }
    
    const userData = room.users.get(socket.id);
    if (!userData) {
      socket.emit('error', { message: 'User not found in room' });
      return;
    }
    
    // Find the poll
    const poll = room.polls.find(p => p.id === pollId);
    if (!poll) {
      socket.emit('error', { message: 'Poll not found' });
      return;
    }
    
    // Check if user already voted on this poll
    if (poll.voters && poll.voters.has(socket.id)) {
      socket.emit('error', { message: 'You have already voted on this poll' });
      return;
    }
    
    // Record the vote with extra metadata
    const voteResult = roomManager.addVoteToPoll(
      roomId, 
      pollId, 
      optionId, 
      socket.id, 
      {
        ...userData,
        userAgent: socket.handshake.headers['user-agent']
      }
    );
    
    if (!voteResult) {
      socket.emit('error', { message: 'Failed to record vote' });
      return;
    }
    
    // Broadcast updated polls to everyone in the room
    io.to(roomId).emit('pollsUpdated', room.polls);
    
    // Also broadcast a vote event with info about who voted
    io.to(roomId).emit('voteReceived', {
      pollId: pollId,
      pollType: 'regular',
      optionId: optionId,
      voter: userData.username,
      timestamp: Date.now()
    });
    
    // Send acknowledgment to the voter
    socket.emit('voteRecorded', {
      pollId: pollId,
      optionId: optionId,
      success: true
    });
    
    console.log(`Vote cast in poll ${pollId} in room ${roomId} by ${userData.username} for option ${optionId}`);
  });
  
  // Create a new poll
  socket.on('createPoll', ({ roomId, question, options }) => {
    if (!roomId || !question || !options || options.length < 2) {
      socket.emit('error', { message: 'Invalid poll data' });
      return;
    }
    
    const room = roomManager.getRoom(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    if (!room.votingEnabled) {
      socket.emit('error', { message: 'Voting is disabled, cannot create new polls' });
      return;
    }
    
    const userData = room.users.get(socket.id);
    if (!userData) {
      socket.emit('error', { message: 'User not found in room' });
      return;
    }
    
    // Create the poll
    const newPoll = roomManager.addPollToRoom(roomId, {
      question,
      options,
      createdBy: userData.username
    });
    
    // Broadcast updated polls to everyone in the room
    io.to(roomId).emit('pollsUpdated', room.polls);
    
    console.log(`New poll created in room ${roomId}: ${question}`);
  });
  
  // Handle voting ended event
  socket.on('votingEnded', ({ roomId }) => {
    if (!roomId) return;
    
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    
    // Close voting in the room
    roomManager.closeVoting(roomId);
    
    // Broadcast to all clients in the room that voting has ended
    io.to(roomId).emit('votingEnded');
    
    console.log(`Voting ended in room ${roomId}`);
  });
  
  // Handle reset timer event (admin only)
  socket.on('resetTimer', ({ roomId }) => {
    if (!roomId) return;
    
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    
    const userData = room.users.get(socket.id);
    if (!userData) return;
    
    // Only allow room creator or admin to reset timer
    if (userData.isAdmin) {
      roomManager.reopenVoting(roomId);
      
      // Broadcast to all clients that timer has been reset
      io.to(roomId).emit('timerReset', {
        timerEndTime: room.timerEndTime
      });
      
      console.log(`Timer reset in room ${roomId} by ${userData.username}`);
    } else {
      // Notify user they don't have permission
      socket.emit('error', { message: 'You do not have permission to reset the timer' });
    }
  });
  
  // Add a new event to get vote stats
  socket.on('getVoteStats', ({ roomId }) => {
    if (!roomId) {
      socket.emit('error', { message: 'Room ID is required' });
      return;
    }
    
    const stats = roomManager.getVoteStats(roomId);
    if (!stats) {
      socket.emit('error', { message: 'Failed to get vote statistics' });
      return;
    }
    
    socket.emit('voteStats', stats);
  });
  
  // Add a simple ping handler for latency measurement
  socket.on('ping', (data, callback) => {
    // Immediately respond to measure latency
    if (callback) callback();
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    // Find which rooms this socket was in
    for (const [roomId, room] of roomManager.rooms.entries()) {
      if (room.users.has(socket.id)) {
        const userData = room.users.get(socket.id);
        
        // Remove user from room
        roomManager.removeUserFromRoom(roomId, socket.id);
        
        // Notify others that user left
        socket.to(roomId).emit('userLeft', {
          username: userData.username,
          userCount: room.users.size
        });
        
        console.log(`${userData.username} disconnected from room ${roomId}`);
      }
    }
    
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Routes
app.get('/api', (req, res) => {
  res.json({ message: 'Welcome to the LLUMO Polling App' });
});

// Get active room IDs
app.get('/api/rooms', (req, res) => {
  const activeRooms = roomManager.getActiveRooms();
  
  // Add more details to each room
  const roomsWithDetails = activeRooms.map(room => ({
    ...room,
    createdAt: new Date(room.createdAt).toISOString(),
    createdTimeAgo: `${Math.floor((Date.now() - room.createdAt) / 60000)} minutes ago`,
    hasDefaultPolls: true
  }));
  
  res.json({ 
    rooms: roomsWithDetails,
    count: roomsWithDetails.length
  });
});

// Get users in a specific room
app.get('/api/rooms/:roomId/users', (req, res) => {
  const { roomId } = req.params;
  if (!roomId) {
    return res.status(400).json({ error: 'Room ID is required' });
  }
  
  const room = roomManager.getRoom(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const users = roomManager.getUsersInRoom(roomId);
  
  res.json({
    roomId,
    userCount: users.length,
    creator: room.creator,
    users
  });
});

// Get stats
app.get('/api/stats', (req, res) => {
  res.json(roomManager.getStats());
});

// Get vote statistics for a specific room
app.get('/api/rooms/:roomId/stats', (req, res) => {
  const { roomId } = req.params;
  if (!roomId) {
    return res.status(400).json({ error: 'Room ID is required' });
  }
  
  const stats = roomManager.getVoteStats(roomId);
  if (!stats) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  res.json(stats);
});

// Get voters for a specific poll in a room
app.get('/api/rooms/:roomId/polls/:pollId/voters', (req, res) => {
  const { roomId, pollId } = req.params;
  if (!roomId || !pollId) {
    return res.status(400).json({ error: 'Room ID and Poll ID are required' });
  }
  
  const room = roomManager.getRoom(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  let poll;
  let voters = [];
  
  if (pollId === 'featured') {
    poll = room.featuredPoll;
  } else {
    poll = room.polls.find(p => p.id.toString() === pollId);
  }
  
  if (!poll) {
    return res.status(404).json({ error: 'Poll not found' });
  }
  
  if (poll.voters) {
    // Convert Map to array for JSON response
    // Remove socket IDs for privacy
    voters = Array.from(poll.voters.entries()).map(([_, voteData]) => ({
      username: voteData.username,
      timestamp: voteData.timestamp,
      optionId: voteData.optionId
    }));
  }
  
  res.json({
    pollId: pollId,
    question: poll.question,
    voterCount: voters.length,
    voters
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 