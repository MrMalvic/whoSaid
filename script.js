const API_URL = 'http://localhost:3000';

const messageEl = document.getElementById('chat-message');
const optionsGrid = document.getElementById('options-grid');
const resultArea = document.getElementById('result-area');
const resultTitle = document.getElementById('result-title');
const resultText = document.getElementById('result-text');
const quizSelection = document.getElementById('quiz-selection');
const quizListEl = document.getElementById('quiz-list');
const gameArea = document.getElementById('game-area');
const endScreen = document.getElementById('end-screen');

let dailyQuestions = [];
let currentQuestionIndex = 0;
let userResults = [];
let isRoundOver = false;
let currentQuizId = null;
let BADGE_MAP = {};

// ========== INITIALIZATION ==========
async function init() {
    // Load badges
    try {
        const badgeRes = await fetch(`${API_URL}/badges-mapping`);
        BADGE_MAP = await badgeRes.json();
        console.log('Badge cache loaded:', Object.keys(BADGE_MAP).length, 'badge sets');
    } catch (err) {
        console.warn('Failed to load badge mappings:', err);
    }

    // Load available quizzes
    await loadQuizzes();

    // Load vote stats
    await loadVoteStats();
}

// ========== VOTING SYSTEM ==========
async function loadVoteStats() {
    try {
        const res = await fetch(`${API_URL}/api/feedback`);
        const data = await res.json();
        document.getElementById('likes-count').textContent = data.likes || 0;
        document.getElementById('dislikes-count').textContent = data.dislikes || 0;

        // Check if already voted
        const voted = localStorage.getItem('site_voted');
        if (voted) {
            disableVoting();
        }
    } catch (err) {
        console.warn('Failed to load votes:', err);
    }
}

async function submitVote(type) {
    if (localStorage.getItem('site_voted')) return;

    // Optimistic update
    const countEl = document.getElementById(type === 'like' ? 'likes-count' : 'dislikes-count');
    const current = parseInt(countEl.textContent || '0');
    countEl.textContent = current + 1;

    // Disable immediately to prevent double clicks
    disableVoting();
    localStorage.setItem('site_voted', type);

    try {
        const res = await fetch(`${API_URL}/api/feedback/${type}`, { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            // Sync with server source of truth
            document.getElementById('likes-count').textContent = data.likes;
            document.getElementById('dislikes-count').textContent = data.dislikes;
        }
    } catch (err) {
        // Revert on failure
        countEl.textContent = current;
        localStorage.removeItem('site_voted');
        enableVoting();
        alert('Failed to submit vote. Is the server running?');
    }
}

function disableVoting() {
    document.getElementById('vote-like').disabled = true;
    document.getElementById('vote-dislike').disabled = true;
    document.getElementById('vote-like').style.opacity = '0.5';
    document.getElementById('vote-dislike').style.opacity = '0.5';
    document.getElementById('vote-like').style.cursor = 'not-allowed';
    document.getElementById('vote-dislike').style.cursor = 'not-allowed';
}

function enableVoting() {
    document.getElementById('vote-like').disabled = false;
    document.getElementById('vote-dislike').disabled = false;
    document.getElementById('vote-like').style.opacity = '1';
    document.getElementById('vote-dislike').style.opacity = '1';
    document.getElementById('vote-like').style.cursor = 'pointer';
    document.getElementById('vote-dislike').style.cursor = 'pointer';
}

// ========== QUIZ SELECTION ==========
// Helper to check if quiz is new (within 24hrs) and not played
function isNewQuiz(quiz) {
    const createdAt = new Date(quiz.createdAt);
    const now = new Date();
    const hoursDiff = (now - createdAt) / (1000 * 60 * 60);
    return hoursDiff < 24;
}

function hasPlayedQuiz(quizId) {
    const played = JSON.parse(localStorage.getItem('played_quizzes') || '[]');
    return played.includes(quizId);
}

function markQuizAsPlayed(quizId) {
    const played = JSON.parse(localStorage.getItem('played_quizzes') || '[]');
    if (!played.includes(quizId)) {
        played.push(quizId);
        localStorage.setItem('played_quizzes', JSON.stringify(played));
    }
}

async function loadQuizzes() {
    try {
        const res = await fetch(`${API_URL}/api/quizzes?public=true`);
        const quizzes = await res.json();

        if (quizzes.length === 0) {
            quizListEl.innerHTML = '<p class="no-quizzes">No quizzes available yet. Check back later!</p>';
            return;
        }

        quizListEl.innerHTML = quizzes.map(q => {
            const showNew = isNewQuiz(q) && !hasPlayedQuiz(q._id);
            const timeAgoStr = timeAgo(q.createdAt);

            return `
            <div class="quiz-card" onclick="selectQuiz('${q._id}')">
                ${showNew ? '<div class="new-badge">NEW</div>' : ''}
                <div class="quiz-header">
                     ${q.emoteUrl ? `<img src="${q.emoteUrl}" class="quiz-emote" alt="Emote">` : ''}
                     <div class="quiz-title">${q.title}</div>
                </div>
                ${q.description ? `<div class="quiz-desc">${q.description}</div>` : ''}
                <div class="quiz-meta">Posted ${timeAgoStr}</div>
            </div>
        `;
        }).join('');
    } catch (err) {
        quizListEl.innerHTML = '<p class="no-quizzes">Failed to load quizzes. Is the server running?</p>';
    }
}

function timeAgo(date) {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + "y ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + "mo ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + "d ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + "h ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + "m ago";
    return "just now";
}

async function selectQuiz(quizId) {
    currentQuizId = quizId;
    markQuizAsPlayed(quizId);

    try {
        const res = await fetch(`${API_URL}/api/quiz/${quizId}`);
        const quiz = await res.json();

        if (!quiz || !quiz.questions || quiz.questions.length === 0) {
            alert('This quiz has no questions!');
            return;
        }

        // Prepare questions with shuffled options
        dailyQuestions = quiz.questions.map(q => {
            const options = [...q.distractors, q.sender];
            options.sort(() => Math.random() - 0.5);

            return {
                id: q._id,
                message: q.message,
                options: options.map(o => ({
                    name: o.name,
                    color: o.color,
                    badges: o.badges
                })),
                answerHash: btoa(q.sender.name)
            };
        });

        // Reset state
        currentQuestionIndex = 0;
        userResults = [];
        isRoundOver = false;

        // Show game area
        quizSelection.classList.add('hidden');
        gameArea.classList.remove('hidden');
        endScreen.classList.add('hidden');

        renderQuestion(0);
    } catch (err) {
        console.error(err);
        alert('Failed to load quiz');
    }
}

function showQuizSelection() {
    // Reset everything
    currentQuizId = null;
    dailyQuestions = [];
    currentQuestionIndex = 0;
    userResults = [];

    // Show selection, hide game
    quizSelection.classList.remove('hidden');
    gameArea.classList.add('hidden');
    endScreen.classList.add('hidden');
    endScreen.innerHTML = '';

    // Remove any existing progress indicator
    const progressEl = document.getElementById('progress-indicator');
    if (progressEl) progressEl.remove();

    // Reload quizzes
    loadQuizzes();
}

// ========== GAME LOGIC ==========
function renderQuestion(index) {
    isRoundOver = false;
    const q = dailyQuestions[index];

    // Update Progress
    let progressEl = document.getElementById('progress-indicator');
    if (!progressEl) {
        progressEl = document.createElement('p');
        progressEl.id = 'progress-indicator';
        progressEl.style.color = 'var(--twitch-purple)';
        progressEl.style.fontWeight = 'bold';
        progressEl.style.textAlign = 'center';
        progressEl.style.marginBottom = '1rem';
        gameArea.insertBefore(progressEl, gameArea.querySelector('.message-box'));
    }
    progressEl.textContent = `Question ${index + 1} / ${dailyQuestions.length}`;

    messageEl.textContent = q.message;
    resultArea.classList.add('hidden');

    // Clean up old next button
    const oldBtn = document.querySelector('.next-btn');
    if (oldBtn) oldBtn.remove();

    renderOptions(q.options);
}

function renderOptions(options) {
    optionsGrid.innerHTML = '';
    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';

        const contentDiv = document.createElement('div');
        contentDiv.style.display = 'flex';
        contentDiv.style.alignItems = 'center';
        contentDiv.style.justifyContent = 'center';
        contentDiv.style.gap = '8px';

        // Render Badges
        if (opt.badges) {
            Object.keys(opt.badges).forEach(key => {
                const version = opt.badges[key];

                let url = null;
                if (BADGE_MAP[key] && BADGE_MAP[key][version]) {
                    url = BADGE_MAP[key][version];
                } else if (BADGE_MAP[key] && BADGE_MAP[key]['1']) {
                    url = BADGE_MAP[key]['1'];
                }

                if (url) {
                    const img = document.createElement('img');
                    img.src = url;
                    img.style.height = '18px';
                    img.style.width = '18px';
                    contentDiv.appendChild(img);
                }
            });
        }

        const nameSpan = document.createElement('span');
        nameSpan.textContent = opt.name;
        nameSpan.style.color = opt.color;
        nameSpan.style.textShadow = '1px 1px 0 #000';

        contentDiv.appendChild(nameSpan);
        btn.appendChild(contentDiv);

        btn.onclick = () => handleGuess(opt.name);
        optionsGrid.appendChild(btn);
    });
}

function handleGuess(selectedName) {
    if (isRoundOver) return;

    const buttons = document.querySelectorAll('.option-btn');
    buttons.forEach(b => b.disabled = true);

    const currentQ = dailyQuestions[currentQuestionIndex];
    const correctName = atob(currentQ.answerHash);
    const isCorrect = (selectedName === correctName);

    const actualSender = currentQ.options.find(o => o.name === correctName);

    userResults.push(isCorrect);
    isRoundOver = true;

    revealRound(selectedName, actualSender, isCorrect);

    // Show Next Button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'next-btn';
    nextBtn.textContent = (currentQuestionIndex < dailyQuestions.length - 1) ? "NEXT QUESTION >" : "SEE RESULTS >";
    nextBtn.onclick = nextQuestion;
    resultArea.appendChild(nextBtn);
}

function revealRound(userGuess, actualSender, isCorrect) {
    const buttons = document.querySelectorAll('.option-btn');
    buttons.forEach(btn => {
        const nameSpan = btn.querySelector('span');
        if (nameSpan && nameSpan.textContent === actualSender.name) {
            btn.style.border = "3px solid var(--accent-green)";
            btn.style.background = "#0f3a1e";
        } else if (nameSpan && nameSpan.textContent === userGuess && !isCorrect) {
            btn.style.border = "3px solid var(--error-red)";
            btn.style.background = "#3a0f0f";
        } else {
            btn.style.opacity = '0.3';
        }
    });

    resultArea.classList.remove('hidden');
    resultTitle.textContent = isCorrect ? "NICE!" : "NOPE.";
    resultTitle.style.color = isCorrect ? "var(--accent-green)" : "var(--error-red)";

    resultText.innerHTML = '';
    if (!isCorrect && actualSender) {
        resultText.innerHTML = `It was <strong style="color:${actualSender.color}">${actualSender.name}</strong>`;
    }
}

function nextQuestion() {
    currentQuestionIndex++;
    if (currentQuestionIndex < dailyQuestions.length) {
        renderQuestion(currentQuestionIndex);
    } else {
        showFinalResults();
    }
}

function showFinalResults() {
    gameArea.classList.add('hidden');

    const score = userResults.filter(r => r).length;

    // Generate Emoji Grid
    let emojiGrid = "";
    userResults.forEach((r, i) => {
        emojiGrid += r ? "🟩" : "🟥";
        if ((i + 1) % 5 === 0) emojiGrid += "\n";
    });

    // Random Tagline
    const PAMS = [
        '🦣 mowl', '🐍 sowl', '🦊 fowl', '🐸 fowl', '🦃 fowl', '🦕 sowl', '🦧 oowl', '🐘 eowl',
        '🦇 bowl', '🐀 rowl', '🐕 dowl', '🐈 meowl', '🐄 cowl', '🦈 shawl', '🐖 powl', '🦁 lowl'
    ];
    const randomPam = PAMS[Math.floor(Math.random() * PAMS.length)];

    endScreen.innerHTML = `
        <h2>CHALLENGE COMPLETE</h2>
        <div class="final-score">${score} / ${dailyQuestions.length}</div>
        <div class="emoji-grid">${emojiGrid.replace(/\n/g, '<br>')}</div>
        <p class="tagline" style="margin: 1rem 0;">This chat is ${randomPam}</p>
        <button id="share-btn" class="share-btn">SHARE RESULT</button>
        <button class="restart-btn" onclick="showQuizSelection()">← BACK TO QUIZZES</button>
    `;

    endScreen.classList.remove('hidden');

    document.getElementById('share-btn').onclick = () => {
        const text = `Daily Zoil Challenge ${new Date().toLocaleDateString()}\nScore: ${score}/${dailyQuestions.length}\n\n${emojiGrid}\n\nPlay here: [link]`;
        navigator.clipboard.writeText(text).then(() => {
            alert("Copied to clipboard!");
        });
    };
}

// Start the app
init();

// Roadmap Modal
function openRoadmap() {
    const modal = document.getElementById('roadmap-modal');
    // Remove hidden class if present
    modal.classList.remove('hidden'); 
    // Small timeout to allow transition
    requestAnimationFrame(() => {
        modal.classList.add('active');
    });
}

function closeRoadmap(e, force = false) {
    if (force || e.target.id === 'roadmap-modal') {
        const modal = document.getElementById('roadmap-modal');
        modal.classList.remove('active');
        // Wait for transition to finish
        setTimeout(() => {
            // modal.classList.add('hidden'); // If needed
        }, 300);
    }
}
