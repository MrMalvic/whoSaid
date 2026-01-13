require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const tmi = require('tmi.js');
const cors = require('cors');
const axios = require('axios');

// Models
const ChatUser = require('./models/ChatUser');
const Quiz = require('./models/Quiz');

const app = express();
const PORT = process.env.PORT || 3000;
const CHANNEL_NAME = process.env.TWITCH_CHANNELS || 'zoil';
const ZOIL_ID = '95304188';

// ========== BOT LIST ==========
const BOT_LIST = new Set([
    'nightbot', 'streamelements', 'fossabot', 'moobot', 'wizebot', 'soundalerts',
    'commanderroot', 'anotherttvviewer', 'lurxx', 'streamlabs', 'stay_hydrated_bot',
    'vivbot', 'drapsnatt', 'logviewer', 'supibot', 'okayegbot', 'botrixoficial',
    'streamholics', 'own3d', 'playwithviewersbot', 'lolrankbot', 'pokemoncommunitygame',
    'sery_bot', 'songlistbot', 'streamcaptainbot', 'kofistreambot', 'rainmaker',
    'mrsmalvic', 'buttsbot', 'creatisbot', 'cloudbot', 'restreambot', 'pretzelrocks',
    'twitchprimereminder', 'blerp', 'mikuia', 'lacyjessica', '0ax2', 'apricotdrupelet',
    'amazeful', 'communityshowcase', 'v_and_k', 'electricallongboard', 'feuerwehr',
    'jobi_gg', 'abbottcostello', 'aliceydra', 'ankhbot', 'coebot', 'deepbot', 'hnlbot',
    'lanfusion', 'muxybot', 'phantombot', 'revlobot', 'scottybot', 'slotsbot',
    'ssakdook', 'streamjar', 'wizebot', 'xanbot', 'zloycabuk', 'pixel__bot', 'lmaobot'
]);

function isBot(username) {
    if (!username) return false;
    const lower = username.toLowerCase();
    return BOT_LIST.has(lower) || lower.endsWith('bot') || lower.includes('_bot');
}

app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// Legacy Schema (keeping for backwards compatibility)
const MessageSchema = new mongoose.Schema({
    message: String,
    sender: {
        name: String,
        color: String,
        badges: Object
    },
    distractors: [{
        name: String,
        color: String,
        badges: Object
    }],
    timestamp: { type: Date, default: Date.now },
    dayOfChallenge: String
});

const ZoilMessage = mongoose.model('ZoilMessage', MessageSchema);

// Feedback Schema for voting
const FeedbackSchema = new mongoose.Schema({
    likes: { type: Number, default: 0 },
    dislikes: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now }
});
const Feedback = mongoose.model('Feedback', FeedbackSchema);

// ========== TWITCH CHAT LISTENER ==========
const client = new tmi.Client({
    connection: { secure: true, reconnect: true },
    channels: [CHANNEL_NAME]
});

client.connect();

// Log ALL chatters to ChatUser model (skip bots)
client.on('message', async (channel, tags, message, self) => {
    if (self) return;

    const twitchId = tags['user-id'];
    const username = tags['username'];
    const displayName = tags['display-name'] || username;
    const color = tags['color'] || '#9146FF';
    const badges = tags['badges'] || {};

    if (!twitchId) return;

    // Skip bots
    if (isBot(username)) return;

    try {
        // Upsert user - update if exists, create if not
        await ChatUser.findOneAndUpdate(
            { twitchId },
            {
                $set: {
                    username: username.toLowerCase(),
                    displayName,
                    color,
                    badges,
                    lastSeen: new Date()
                },
                $inc: { messageCount: 1 }
            },
            { upsert: true, new: true }
        );
    } catch (err) {
        // Ignore duplicate key errors that may occur during race conditions
        if (err.code !== 11000) {
            console.error('Error logging user:', err.message);
        }
    }
});

// ========== API ROUTES ==========

// Get random distractors from local ChatUser DB (excludes bots)
app.get('/api/users/random', async (req, res) => {
    try {
        const count = parseInt(req.query.count) || 3;
        const exclude = req.query.exclude ? req.query.exclude.toLowerCase() : '';

        // Build exclusion list with bots
        const excludeList = [...BOT_LIST];
        if (exclude) excludeList.push(exclude);

        const pipeline = [
            { $match: { username: { $nin: excludeList } } },
            { $sample: { size: count } },
            { $project: { _id: 0, name: '$displayName', color: 1, badges: 1, username: 1 } }
        ];

        const users = await ChatUser.aggregate(pipeline);
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Search users for distractor selection
app.get('/api/users/search', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query || query.length < 2) {
            return res.json([]);
        }

        const users = await ChatUser.find({
            username: {
                $regex: query,
                $options: 'i',
                $nin: [...BOT_LIST]
            }
        })
            .limit(10)
            .select('displayName color badges username -_id');

        res.json(users.map(u => ({
            name: u.displayName,
            color: u.color,
            badges: u.badges,
            username: u.username
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single user details (enrichment)
app.get('/api/user/:username', async (req, res) => {
    try {
        const user = await ChatUser.findOne({
            username: req.params.username.toLowerCase()
        });

        if (!user) return res.status(404).json({ error: 'User not found' });

        res.json({
            username: user.username,
            displayName: user.displayName,
            color: user.color,
            badges: user.badges
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Feedback Endpoints
app.get('/api/feedback', async (req, res) => {
    try {
        let fb = await Feedback.findOne();
        if (!fb) fb = await Feedback.create({});
        res.json(fb);
    } catch (err) {
        res.status(500).json({ likes: 0, dislikes: 0 });
    }
});

app.post('/api/feedback/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const update = type === 'like' ? { $inc: { likes: 1 } } :
            type === 'dislike' ? { $inc: { dislikes: 1 } } : {};

        if (!Object.keys(update).length) return res.status(400).json({ error: 'Invalid type' });

        const fb = await Feedback.findOneAndUpdate({}, update, { upsert: true, new: true });
        res.json(fb);
    } catch (err) {
        res.status(500).json({ error: 'Failed to vote' });
    }
});

// Helper: Parse IVR plain text logs
// Format: "[2026-01-13 00:00:18] #zoil mrsmalvic: Hello world"
function parseIvrLogs(text) {
    // Handle both Unix (\n) and Windows (\r\n) line endings
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    const regex = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] #(\w+) (\w+): (.+)$/;

    return lines.map(line => {
        const match = line.match(regex);
        if (!match) return null;

        return {
            timestamp: match[1].replace(' ', 'T') + 'Z',
            channel: match[2],
            username: match[3].toLowerCase(),
            displayName: match[3],
            message: match[4]
        };
    }).filter(Boolean);
}

// Get recent logs for admin quiz builder
app.get('/api/logs/recent', async (req, res) => {
    try {
        // Construct URL with today's date (IVR redirects /channel/zoil to dated URL)
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const url = `https://logs.ivr.fi/channel/${CHANNEL_NAME}/${year}/${month}/${day}`;

        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 10000,
            responseType: 'text'
        });

        const allMessages = parseIvrLogs(response.data);

        // Filter out bots
        const filtered = allMessages.filter(msg => !isBot(msg.username));

        // Sort by timestamp descending (newest first)
        filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Transform to our format
        const results = filtered.slice(0, 100).map(msg => ({
            id: `${msg.timestamp}-${msg.username}`,
            message: msg.message,
            sender: {
                name: msg.displayName,
                color: '#9146FF',
                badges: {}
            },
            timestamp: msg.timestamp
        }));

        res.json({
            total: filtered.length,
            showing: results.length,
            messages: results
        });
    } catch (err) {
        console.error('Recent logs error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Advanced search: date range + fuzzy search
// Query params: q (search term), from (YYYY-MM-DD), to (YYYY-MM-DD), limit (default 200)
app.get('/api/logs/search', async (req, res) => {
    try {
        const { q, from, to, limit = 1000 } = req.query;

        if (!from || !to) {
            return res.status(400).json({ error: 'from and to dates are required (YYYY-MM-DD)' });
        }

        const fromDate = new Date(from);
        const toDate = new Date(to);

        if (isNaN(fromDate) || isNaN(toDate)) {
            return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
        }

        // Calculate days between (max 365)
        const daysDiff = Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24)) + 1;
        if (daysDiff > 365) {
            return res.status(400).json({ error: 'Date range cannot exceed 365 days' });
        }
        if (daysDiff < 1) {
            return res.status(400).json({ error: 'from date must be before to date' });
        }

        const allMessages = [];
        const daysSearched = [];

        // Determine days to search
        const datesToSearch = [];
        for (let i = 0; i < daysDiff; i++) {
            const date = new Date(fromDate);
            date.setDate(date.getDate() + i);
            datesToSearch.push(date);
        }

        // Process in batches to control concurrency (e.g. 10 at a time)
        const BATCH_SIZE = 10;

        for (let i = 0; i < datesToSearch.length; i += BATCH_SIZE) {
            const batch = datesToSearch.slice(i, i + BATCH_SIZE);

            await Promise.all(batch.map(async (date) => {
                const year = date.getFullYear();
                const month = date.getMonth() + 1;
                const day = date.getDate();

                try {
                    const url = `https://logs.ivr.fi/channel/${CHANNEL_NAME}/${year}/${month}/${day}`;
                    const response = await axios.get(url, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                        timeout: 5000,
                        responseType: 'text'
                    });

                    const messages = parseIvrLogs(response.data);
                    allMessages.push(...messages);
                    daysSearched.push(`${year}-${month}-${day}`);
                } catch (err) {
                    // Day might not exist, skip
                }
            }));
        }

        // Filter by user (exact match, case insensitive)
        const { user } = req.query;
        let filtered = allMessages;

        if (user) {
            const targetUser = user.toLowerCase();
            filtered = filtered.filter(msg => msg.username === targetUser);
        }

        // Filter by search query (fuzzy/substring)
        if (q) {
            const lowerQuery = q.toLowerCase();
            filtered = filtered.filter(msg =>
                msg.message.toLowerCase().includes(lowerQuery)
            );
        }

        // Filter out bots
        filtered = filtered.filter(msg => !isBot(msg.username));

        // Sort by timestamp descending
        filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Transform to our format
        const results = filtered.slice(0, parseInt(limit)).map(msg => ({
            id: `${msg.timestamp}-${msg.username}`,
            message: msg.message,
            sender: {
                name: msg.displayName,
                color: '#9146FF',
                badges: {}
            },
            timestamp: msg.timestamp
        }));

        res.json({
            total: filtered.length,
            showing: results.length,
            daysSearched: daysSearched.length,
            messages: results
        });
    } catch (err) {
        console.error('IVR search error:', err.message);
        res.status(500).json({ error: err.message });
    }
})

// ========== QUIZ CRUD ==========

// Create a new quiz
app.post('/api/quiz', async (req, res) => {
    try {
        const { title, description, questions } = req.body;

        if (!title || !questions || questions.length === 0) {
            return res.status(400).json({ error: 'title and questions are required' });
        }

        const quiz = await Quiz.create({
            title,
            description,
            emoteUrl: req.body.emoteUrl,
            questions,
            isActive: false
        });

        res.json(quiz);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all quizzes
app.get('/api/quizzes', async (req, res) => {
    try {
        const query = {};
        if (req.query.public === 'true') {
            query.isActive = true;
        }

        const quizzes = await Quiz.find(query)
            .select('title description emoteUrl createdAt isActive questions')
            .sort({ createdAt: -1 });

        res.json(quizzes.map(q => ({
            ...q.toObject(),
            questionCount: q.questions.length
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get specific quiz
app.get('/api/quiz/:id', async (req, res) => {
    try {
        const quiz = await Quiz.findById(req.params.id);
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
        res.json(quiz);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Toggle quiz active status (Publish/Unpublish)
app.post('/api/quiz/:id/toggle', async (req, res) => {
    try {
        const quiz = await Quiz.findById(req.params.id);
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

        quiz.isActive = !quiz.isActive;
        await quiz.save();

        res.json({ success: true, quiz });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete quiz
app.delete('/api/quiz/:id', async (req, res) => {
    try {
        await Quiz.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== GAME ENDPOINTS ==========

// Get daily challenge (from active quiz)
app.get('/daily', async (req, res) => {
    try {
        // First try to get active quiz
        const activeQuiz = await Quiz.findOne({ isActive: true });

        if (activeQuiz && activeQuiz.questions.length > 0) {
            const responseData = activeQuiz.questions.map(q => {
                const options = [...q.distractors, q.sender];
                options.sort(() => Math.random() - 0.5);

                const ans = Buffer.from(q.sender.name).toString('base64');

                return {
                    id: q._id,
                    message: q.message,
                    options: options.map(o => ({
                        name: o.name,
                        color: o.color,
                        badges: o.badges
                    })),
                    answerHash: ans
                };
            });

            return res.json({
                date: new Date().toISOString().split('T')[0],
                quizTitle: activeQuiz.title,
                questions: responseData
            });
        }

        // Fallback to legacy random messages
        const count = await ZoilMessage.countDocuments();
        if (count === 0) return res.json({ error: "No quiz active and no messages available." });

        const sampleSize = Math.min(count, 10);
        const questions = await ZoilMessage.aggregate([{ $sample: { size: sampleSize } }]);

        const responseData = questions.map(q => {
            const options = [...q.distractors, q.sender];
            options.sort(() => Math.random() - 0.5);

            const ans = Buffer.from(q.sender.name).toString('base64');

            return {
                id: q._id,
                message: q.message,
                options: options,
                answerHash: ans
            };
        });

        res.json({
            date: new Date().toISOString().split('T')[0],
            questions: responseData
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== BADGE PROXY ==========
let badgeCache = null;

app.get('/badges-mapping', async (req, res) => {
    if (badgeCache) return res.json(badgeCache);

    try {
        // Fetch both global and channel badges
        const [globalRes, channelRes] = await Promise.all([
            axios.get('https://api.ivr.fi/v2/twitch/badges/global', { timeout: 5000 }),
            axios.get(`https://api.ivr.fi/v2/twitch/badges/channel?id=${ZOIL_ID}`, { timeout: 5000 })
        ]);

        const badgeMap = {};

        // Process global badges first (includes vip, moderator, broadcaster, etc.)
        for (const badge of globalRes.data) {
            badgeMap[badge.set_id] = {};
            for (const version of badge.versions) {
                badgeMap[badge.set_id][version.id] = version.image_url_1x;
            }
        }

        // Channel badges override global (for custom subscriber badges)
        for (const badge of channelRes.data) {
            badgeMap[badge.set_id] = {};
            for (const version of badge.versions) {
                badgeMap[badge.set_id][version.id] = version.image_url_1x;
            }
        }

        badgeCache = badgeMap;
        console.log(`Badge cache populated with ${Object.keys(badgeMap).length} badge sets (global + channel)`);
        res.json(badgeCache);
    } catch (err) {
        console.error('Failed to fetch badges from IVR:', err.message);
        res.status(500).json({});
    }
});

// ========== STATS ==========
app.get('/api/stats', async (req, res) => {
    try {
        const userCount = await ChatUser.countDocuments();
        const quizCount = await Quiz.countDocuments();
        const activeQuiz = await Quiz.findOne({ isActive: true }).select('title');

        res.json({
            totalChatters: userCount,
            totalQuizzes: quizCount,
            activeQuiz: activeQuiz ? activeQuiz.title : null
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
