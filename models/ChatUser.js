const mongoose = require('mongoose');

const ChatUserSchema = new mongoose.Schema({
    twitchId: { type: String, required: true, unique: true, index: true },
    username: { type: String, required: true, index: true },  // lowercase login
    displayName: { type: String, required: true },
    color: { type: String, default: '#9146FF' },
    badges: { type: Object, default: {} },  // { subscriber: '12', vip: '1', ... }
    lastSeen: { type: Date, default: Date.now },
    messageCount: { type: Number, default: 1 }
});

// Index for random sampling
ChatUserSchema.index({ lastSeen: -1 });

module.exports = mongoose.model('ChatUser', ChatUserSchema);
