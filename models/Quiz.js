const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema({
    message: { type: String, required: true },
    sender: {
        name: { type: String, required: true },
        color: { type: String, default: '#9146FF' },
        badges: { type: Object, default: {} }
    },
    distractors: [{
        name: { type: String, required: true },
        color: { type: String, default: '#808080' },
        badges: { type: Object, default: {} }
    }],
    sourceMessageId: String,  // IVR message ID for reference
    sourceDate: Date          // Original message date
});

const QuizSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: String,
    emoteUrl: String, // Optional: Emote image for the quiz
    questions: [QuestionSchema],
    createdAt: { type: Date, default: Date.now },
    scheduledFor: Date,       // Optional: scheduled publish date
    isActive: { type: Boolean, default: false, index: true }
});

module.exports = mongoose.model('Quiz', QuizSchema);
