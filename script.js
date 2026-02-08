let peer, localStream, remoteStream, conn;
const canvas = document.getElementById('master-canvas');
const ctx = canvas.getContext('2d');

let currentStep = 0;
let totalSteps = 3;
let isBusy = false;
let isLocalMirrored = true;

// --- 1. INITIALIZATION ---

// Create a random 4-letter ID for this session
const myId = Math.random().toString(36).substring(2, 6).toUpperCase();

// Start up PeerJS
peer = new Peer(myId, {
    debug: 2 // Logs errors but keeps the console relatively clean
});

// When we are ready to connect
peer.on('open', id => {
    console.log("My Peer ID: " + id);
    document.getElementById('display-id').textContent = id;
});

// If something breaks (network issues, etc.)
peer.on('error', err => {
    console.error("PeerJS Error:", err.type, err);
    alert("Connection Error: " + err.type);
});

// When someone connects to our Data channel (controls/syncing)
peer.on('connection', c => {
    conn = c;
    setupDataListeners(conn);
    updateConnectionStatus(true);
    // Give it a split second to settle, then send them my current settings
    setTimeout(() => broadcastAllState(), 500);
});

// When someone calls us with Video
peer.on('call', async (call) => {
    try {
        // Get my camera ready
        const stream = await getLocalStream();
        // Answer the call and send my stream back
        call.answer(stream);
        // Listen for their stream
        call.on('stream', s => handleRemoteStream(s));
    } catch (err) { console.error("Media Error:", err); }
});

// --- PATCH #3: CLEAN UP ON EXIT ---
// If the user closes the tab or refreshes, kill the connection immediately.
// Otherwise, the ID stays "taken" for a while.
window.addEventListener('beforeunload', () => {
    if (conn) {
        conn.close();
    }
    if (peer) {
        peer.destroy();
    }
});

// --- 2. SETUP & JOIN ---

// "Start Booth" button
document.getElementById('create-btn').onclick = async () => {
    document.getElementById('my-code-box').classList.remove('hidden');
    await getLocalStream();
};

// "Join Booth" button
document.getElementById('join-btn').onclick = async () => {
    const code = document.getElementById('join-id').value.toUpperCase();
    if(!code) return alert("Please enter a code");
    
    try {
        // Turn on camera first
        const stream = await getLocalStream();

        // 1. Connect Data (Text/Controls)
        conn = peer.connect(code, { reliable: true });
        
        if (conn) {
            setupDataListeners(conn);
            updateConnectionStatus(true);
            conn.on('open', () => {
                broadcastAllState(); // Send them my settings
            });
        }

        // 2. Connect Video
        const call = peer.call(code, stream);
        if (call) {
            call.on('stream', s => handleRemoteStream(s));
        }
    } catch (err) { 
        console.error("Join Error:", err);
        alert("Join failed: " + err.message); 
    }
};

// Helper to turn on the webcam
async function getLocalStream() {
    // If we already have it, don't ask again
    if (localStream) return localStream;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { 
                width: { ideal: 1280 }, 
                height: { ideal: 720 }, 
                facingMode: "user" 
            },
            audio: true
        });
        
        localStream = stream;
        const videoEl = document.getElementById('local-video');
        
        // --- PATCH #2: iOS FIXES ---
        // iPhones often won't play video unless it's muted first
        videoEl.muted = true; 
        videoEl.playsInline = true; 
        videoEl.srcObject = stream;
        
        // --- PATCH #1: SECURITY FIX ---
        // We need this so the Canvas can take a screenshot of the video later
        videoEl.setAttribute('crossorigin', 'anonymous'); 

        await videoEl.play().catch(e => console.log("Local play error", e));
        return stream;
    } catch (e) {
        alert("Camera access denied or missing.");
        throw e;
    }
}

// Helper to handle the other person's video
function handleRemoteStream(stream) {
    remoteStream = stream;
    const videoEl = document.getElementById('remote-video');
    
    // iOS Safari needs this to play inline (not fullscreen)
    videoEl.playsInline = true; 
    videoEl.srcObject = stream;

    // Security fix for the canvas
    videoEl.setAttribute('crossorigin', 'anonymous');

    // Force it to play once data loads
    videoEl.onloadedmetadata = () => {
        videoEl.play().catch(e => console.log("Remote play error:", e));
    };
    
    startBooth();
    updateConnectionStatus(true);
}

// --- 3. STATE SYNC & CONTROLS ---

// Things we want to sync between users
const inputs = ['layout-select', 'filter-select', 'border-select', 'color-select', 'caption-input'];

// Add listeners to all those inputs
inputs.forEach(id => {
    const el = document.getElementById(id);
    const eventType = id === 'caption-input' ? 'input' : 'change';
    
    el.addEventListener(eventType, (e) => {
        // Update local screen immediately
        if (id === 'filter-select') applyLiveFilter(e.target.value);
        if (id === 'layout-select' || id === 'color-select' || id === 'border-select') updateBlueprint();
        
        // Send the change to the partner
        if (conn && conn.open) {
            conn.send({
                type: 'STATE_UPDATE',
                key: id,
                value: e.target.value
            });
        }
    });
});

// Send all my current settings to the partner
function broadcastAllState() {
    if (!conn || !conn.open) return;
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            conn.send({
                type: 'STATE_UPDATE',
                key: id,
                value: el.value
            });
        }
    });
}

// Listen for messages from the partner
function setupDataListeners(c) {
    c.on('data', data => {
        // They pressed the snap button
        if (data.type === 'SNAP_NEXT' && !isBusy) {
            takeNextPhoto();
        } 
        // They changed a setting
        else if (data.type === 'STATE_UPDATE') {
            const el = document.getElementById(data.key);
            if (el) {
                el.value = data.value;
                // Update visuals based on what they changed
                if (data.key === 'filter-select') applyLiveFilter(data.value);
                if (['layout-select', 'color-select', 'border-select'].includes(data.key)) updateBlueprint();
            }
        }
    });
    
    c.on('close', () => {
        console.log("Peer connection closed");
        updateConnectionStatus(false);
    });
    c.on('error', (err) => console.error("Conn Error:", err));
}

// --- 4. LIVE FILTERS ---

function applyLiveFilter(filterVal) {
    const cssFilter = filterVal === "none" ? "none" : filterVal;
    // Apply CSS filters to the video tags for preview
    document.getElementById('local-video').style.filter = cssFilter;
    document.getElementById('remote-video').style.filter = cssFilter;
}

// --- 5. BOOTH LOGIC ---

// Flip my video like a mirror
document.getElementById('mirror-toggle').onclick = () => {
    isLocalMirrored = !isLocalMirrored;
    document.getElementById('local-video').classList.toggle('unmirrored', !isLocalMirrored);
};

function startBooth() {
    // Hide setup, show booth
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('booth-screen').classList.remove('hidden');
    document.querySelector('.sidebar').classList.add('active');
    
    // AUDIO HACK: Play a silent sound to "unlock" audio on mobile browsers
    const tick = document.getElementById('snd-tick');
    if(tick) {
        tick.play().then(() => {
            tick.pause();
            tick.currentTime = 0;
        }).catch(e => console.log("Audio unlock ignored"));
    }

    applyLiveFilter(document.getElementById('filter-select').value);
    resetBoothState();
}

function updateConnectionStatus(isLive) {
    const dot = document.getElementById('status-dot');
    if(dot) dot.className = isLive ? 'status-dot live' : 'status-dot dead';
    const toast = document.getElementById('toast-container');
    if(toast) toast.classList.toggle('hidden', isLive);
}

// Shutter button click
document.getElementById('snap-btn').onclick = () => {
    if (isBusy) return;
    // Tell partner to snap too
    if (conn && conn.open) conn.send({ type: 'SNAP_NEXT' });
    takeNextPhoto();
};

async function takeNextPhoto() {
    if (isBusy || currentStep >= totalSteps) return;
    isBusy = true;
    const btn = document.getElementById('snap-btn');
    btn.classList.add('busy');

    try {
        const layout = document.getElementById('layout-select').value;
        // Default settings for single photo
        let xPos = 75, yPos = 75, size = 310; 
        totalSteps = 1;

        // Adjust positions if we are doing a strip or grid
        if (layout === 'strip') {
            totalSteps = 3;
            yPos = [50, 365, 680][currentStep];
            xPos = 60; size = 280;
        } else if (layout === 'grid') {
            totalSteps = 2;
            yPos = [50, 365][currentStep];
            xPos = 60; size = 280;
        }

        // If it's the first photo, prepare the canvas
        if (currentStep === 0) {
            canvas.width = (layout === 'polaroid') ? 800 : 700; 
            canvas.height = (layout === 'strip') ? 1100 : (layout === 'grid' ? 800 : 650);
            
            // Fill background color
            ctx.fillStyle = document.getElementById('color-select').value;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // Take the picture
        await captureRow(currentStep, xPos, yPos, size);
        currentStep++;

        // Check if we are done or need another shot
        if (currentStep >= totalSteps) {
            finishSession();
            btn.classList.replace('busy', 'done');
        } else {
            btn.classList.remove('busy');
            isBusy = false;
        }
    } catch (e) {
        console.error(e);
        isBusy = false;
        btn.classList.remove('busy');
    }
}

async function captureRow(rowIdx, x, y, size) {
    const overlay = document.getElementById('screen-overlay');
    const countText = document.getElementById('countdown-text');
    const flash = document.getElementById('flash-layer');
    const sndTick = document.getElementById('snd-tick');

    overlay.classList.remove('hidden');

    // 3... 2... 1...
    for (let i = 3; i > 0; i--) {
        countText.innerText = i;
        if(sndTick) {
            sndTick.currentTime = 0;
            sndTick.play().catch(()=>{});
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    countText.innerText = "";
    flash.classList.add('flash-trigger');
    
    // Set the filter on the canvas context so it gets baked into the image
    const filterVal = document.getElementById('filter-select').value;
    ctx.filter = filterVal === "none" ? "none" : filterVal;
    
    const borderColor = document.getElementById('border-select').value;
    
    // Draw the local video (me)
    drawSquareCrop(document.getElementById('local-video'), x, y, size, isLocalMirrored, borderColor);
    
    // Draw the remote video (them) to the right
    drawSquareCrop(document.getElementById('remote-video'), x + size + 20, y, size, false, borderColor);

    updateMiniPreview(rowIdx, x, y, size);
    
    // Wait a bit for flash to fade
    await new Promise(r => setTimeout(r, 400));
    flash.classList.remove('flash-trigger');
    overlay.classList.add('hidden');
}

function drawSquareCrop(video, x, y, size, shouldMirror, borderColor) {
    // If video isn't ready, draw a black box
    if(video.readyState < 2) {
        ctx.fillStyle = "#222";
        ctx.fillRect(x, y, size, size);
        return;
    }

    // Calculate crop dimensions
    const vW = video.videoWidth;
    const vH = video.videoHeight;
    const m = Math.min(vW, vH);
    const sx = (vW - m) / 2;
    const sy = (vH - m) / 2;

    ctx.save();
    ctx.beginPath(); 
    ctx.rect(x, y, size, size); 
    ctx.clip(); // Only draw inside this square

    if (shouldMirror) {
        // FLIP LOGIC: Move to the right side, flip horizontally
        ctx.translate(x + size, y); 
        ctx.scale(-1, 1);
        ctx.drawImage(video, sx, sy, m, m, 0, 0, size, size);
    } else {
        ctx.drawImage(video, sx, sy, m, m, x, y, size, size);
    }
    ctx.restore();

    // Draw the colored border
    ctx.filter = 'none'; 
    ctx.strokeStyle = borderColor; 
    ctx.lineWidth = 15;
    ctx.strokeRect(x, y, size, size);
}

function finishSession() {
    const paper = document.getElementById('color-select').value;
    
    // Add "Paper Texture" (Noise)
    ctx.save();
    ctx.globalCompositeOperation = 'multiply'; 
    ctx.globalAlpha = 0.08;
    
    // Generate random noise
    const pCanvas = document.createElement('canvas');
    pCanvas.width = 100; pCanvas.height = 100;
    const pCtx = pCanvas.getContext('2d');
    for(let i=0; i<400; i++) {
        pCtx.fillStyle = `rgba(0,0,0,${Math.random()})`;
        pCtx.fillRect(Math.random()*100, Math.random()*100, 1, 1);
    }
    ctx.fillStyle = ctx.createPattern(pCanvas, 'repeat');
    ctx.fillRect(0,0,canvas.width, canvas.height);
    ctx.restore();

    // Add Date/Caption at the bottom
    const isDark = (paper === "#2d3436" || paper === "#3e2723");
    ctx.fillStyle = isDark ? "#fffbf0" : "#800000";
    let cap = document.getElementById('caption-input').value.trim();
    if(!cap) cap = "Yanahgi " + new Date().toLocaleDateString();
    
    ctx.font = "italic 700 24px Georgia"; 
    ctx.textAlign = "center";
    ctx.fillText(cap, canvas.width / 2, canvas.height - 40);

    // --- SAVE IMAGE ---
    // If we missed the crossOrigin fix earlier, this line will crash the app
    try {
        document.getElementById('final-img').src = canvas.toDataURL('image/png');
        document.getElementById('result-modal').classList.remove('hidden');
    } catch (e) {
        console.error("Canvas Taint Error:", e);
        alert("Security Error: Could not save image. (Canvas Tainted)");
    }
}

function resetBoothState() {
    currentStep = 0; isBusy = false;
    const btn = document.getElementById('snap-btn');
    if(btn) btn.className = 'snap-btn';
    updateBlueprint();
}

// Draws the little squares in the sidebar to show progress
function updateBlueprint() {
    const layout = document.getElementById('layout-select').value;
    const container = document.getElementById('blueprint');
    const borderColor = document.getElementById('border-select').value;
    const paperColor = document.getElementById('color-select').value;
    
    const rows = layout === 'strip' ? 3 : (layout === 'grid' ? 2 : 1);
    
    container.style.background = paperColor;
    container.innerHTML = '';
    
    for(let i=0; i<rows; i++) {
        container.innerHTML += `<div class="slot-pair">
            <div class="mini-square" id="slot-${i}-L" style="border: 2px solid ${borderColor}"></div>
            <div class="mini-square" id="slot-${i}-R" style="border: 2px solid ${borderColor}"></div>
        </div>`;
    }
}

// Copy the main canvas image into the sidebar slots
function updateMiniPreview(row, x, y, size) {
    const extract = (offX) => {
        const temp = document.createElement('canvas'); 
        temp.width = size; temp.height = size;
        const tCtx = temp.getContext('2d');
        tCtx.drawImage(canvas, offX, y, size, size, 0, 0, size, size);
        return temp.toDataURL();
    };
    
    const slotL = document.getElementById(`slot-${row}-L`);
    const slotR = document.getElementById(`slot-${row}-R`);
    if(slotL) slotL.innerHTML = `<img src="${extract(x)}">`;
    if(slotR) slotR.innerHTML = `<img src="${extract(x + size + 20)}">`;
}

document.getElementById('download-btn').onclick = () => {
    const link = document.createElement('a');
    link.download = `Yanahgi-${Date.now()}.png`;
    link.href = document.getElementById('final-img').src;
    link.click();
};

document.getElementById('close-btn').onclick = () => {
    document.getElementById('result-modal').classList.add('hidden');
    resetBoothState();
};

// Auto-Reconnect check: if user tabs out and back in
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'visible') {
        if (conn && !conn.open) {
            console.log("Returned to tab, connection appears broken.");
            updateConnectionStatus(false);
        }
    }
});
