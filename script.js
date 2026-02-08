let peer, localStream, remoteStream, conn;
const canvas = document.getElementById('master-canvas');
const ctx = canvas.getContext('2d');

let currentStep = 0;
let totalSteps = 3; 
let isBusy = false; 
let isLocalMirrored = true;

// 1. Initialize Peer with Error Handling
const myId = Math.random().toString(36).substring(2, 8).toUpperCase();
peer = new Peer(myId);

peer.on('open', id => {
    console.log("My Peer ID is: " + id);
    document.getElementById('display-id').textContent = id;
});

// Catch errors (like 'peer-unavailable' if the code is wrong)
peer.on('error', err => {
    console.error("PeerJS Error:", err.type);
    alert("Connection Error: " + err.type);
});

peer.on('connection', c => { 
    conn = c; 
    setupDataListeners(conn); // Pass conn directly to be safe
    updateConnectionStatus(true);
});

peer.on('call', async (call) => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
        setupLocalStream(stream);
        call.answer(stream);
        call.on('stream', s => { 
            remoteStream = s; 
            document.getElementById('remote-video').srcObject = s; 
            startBooth(); 
            updateConnectionStatus(true);
        });
    } catch (err) { console.error("Media Error:", err); }
});

// Setup & Join
document.getElementById('create-btn').onclick = async () => {
    document.getElementById('my-code-box').classList.remove('hidden');
    const stream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
    setupLocalStream(stream);
};

document.getElementById('join-btn').onclick = async () => {
    const code = document.getElementById('join-id').value.toUpperCase();
    if(!code) return alert("Please enter a code");
    
    // Ensure Peer is ready
    if (!peer.id) return alert("Peer not initialized yet. Wait a second.");

    try {
        const stream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
        setupLocalStream(stream);

        // Connect Data
        conn = peer.connect(code);
        if (conn) {
            setupDataListeners(conn);
        } else {
            throw new Error("Failed to create connection object");
        }

        // Connect Video
        const call = peer.call(code, stream);
        if (call) {
            call.on('stream', s => { 
                remoteStream = s; 
                document.getElementById('remote-video').srcObject = s; 
                startBooth();
            });
        }
    } catch (err) { 
        console.error("Join Error:", err);
        alert("Join failed: " + err.message); 
    }
};

document.getElementById('mirror-toggle').onclick = () => {
    isLocalMirrored = !isLocalMirrored;
    document.getElementById('local-video').classList.toggle('unmirrored', !isLocalMirrored);
};

// 2. Updated to accept 'c' as an argument to prevent "undefined" errors
function setupDataListeners(c) {
    if (!c) return;
    c.on('data', data => { 
        if (data.type === 'SNAP_NEXT' && !isBusy) takeNextPhoto(); 
    });
    c.on('close', () => updateConnectionStatus(false));
    c.on('error', (err) => console.error("Conn Error:", err));
}

function updateConnectionStatus(isLive) {
    const dot = document.getElementById('status-dot');
    dot.className = isLive ? 'status-dot live' : 'status-dot dead';
    document.getElementById('toast-container').classList.toggle('hidden', isLive);
}

function setupLocalStream(stream) {
    localStream = stream;
    document.getElementById('local-video').srcObject = stream;
}

function startBooth() {
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('booth-screen').classList.remove('hidden');
    document.querySelector('.sidebar').classList.add('active');
    document.querySelector('.sidebar').style.display = 'flex';
    resetBoothState();
}

document.getElementById('snap-btn').onclick = () => {
    if (isBusy) return;
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
        let xPos = 60, yPos = 50, size = 280;

        if (layout === 'strip') {
            totalSteps = 3;
            yPos = [50, 365, 680][currentStep];
        } else if (layout === 'grid') {
            totalSteps = 2;
            yPos = [50, 365][currentStep];
        } else {
            totalSteps = 1; xPos = 75; yPos = 75; size = 310;
        }

        if (currentStep === 0) {
            canvas.width = (layout === 'polaroid') ? 800 : 700;
            canvas.height = (layout === 'strip') ? 1100 : (layout === 'grid' ? 800 : 650);
            ctx.fillStyle = document.getElementById('color-select').value;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        await captureRow(currentStep, xPos, yPos, size);
        currentStep++;

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

    for (let i = 3; i > 0; i--) {
        countText.innerText = i;
        sndTick.currentTime = 0;
        sndTick.play().catch(()=>{});
        await new Promise(r => setTimeout(r, 1000));
    }

    countText.innerText = "";
    flash.classList.add('flash-trigger');
    
    const filterVal = document.getElementById('filter-select').value;
    ctx.filter = filterVal === "none" ? "none" : filterVal;
    
    const borderColor = document.getElementById('border-select').value;
    drawSquareCrop(document.getElementById('local-video'), x, y, size, isLocalMirrored, borderColor);
    drawSquareCrop(document.getElementById('remote-video'), x + size + 20, y, size, false, borderColor);

    updateMiniPreview(rowIdx, x, y, size, borderColor);
    await new Promise(r => setTimeout(r, 400));
    flash.classList.remove('flash-trigger');
    overlay.classList.add('hidden');
}

function drawSquareCrop(video, x, y, size, shouldMirror, borderColor) {
    const vW = video.videoWidth, vH = video.videoHeight;
    const m = Math.min(vW, vH);
    const sx = (vW - m) / 2, sy = (vH - m) / 2;

    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip();

    if (shouldMirror) {
        ctx.translate(x + size, y); ctx.scale(-1, 1);
        ctx.drawImage(video, sx, sy, m, m, 0, 0, size, size);
    } else {
        ctx.drawImage(video, sx, sy, m, m, x, y, size, size);
    }
    ctx.restore();

    ctx.filter = 'none';
    ctx.strokeStyle = borderColor; ctx.lineWidth = 15;
    ctx.strokeRect(x, y, size, size);
}

function finishSession() {
    const paper = document.getElementById('color-select').value;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.08;
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

    const isDark = (paper === "#2d3436" || paper === "#3e2723");
    ctx.fillStyle = isDark ? "#fffbf0" : "#800000";
    let cap = document.getElementById('caption-input').value.trim() || "YANAHGI ARCHIVE // " + new Date().toLocaleDateString();
    ctx.font = "italic 700 24px Georgia"; ctx.textAlign = "center";
    ctx.fillText(cap, canvas.width / 2, canvas.height - 40);

    document.getElementById('final-img').src = canvas.toDataURL('image/png');
    document.getElementById('result-modal').classList.remove('hidden');
}

function resetBoothState() {
    currentStep = 0; isBusy = false;
    document.getElementById('snap-btn').className = 'snap-btn';
    updateBlueprint();
}

function updateBlueprint() {
    const layout = document.getElementById('layout-select').value;
    const container = document.getElementById('blueprint');
    const borderColor = document.getElementById('border-select').value;
    const rows = layout === 'strip' ? 3 : (layout === 'grid' ? 2 : 1);
    
    container.innerHTML = '';
    for(let i=0; i<rows; i++) {
        container.innerHTML += `<div class="slot-pair">
            <div class="mini-square" id="slot-${i}-L" style="border: 2px solid ${borderColor}"></div>
            <div class="mini-square" id="slot-${i}-R" style="border: 2px solid ${borderColor}"></div>
        </div>`;
    }
    container.style.background = document.getElementById('color-select').value;
}

function updateMiniPreview(row, x, y, size, borderColor) {
    const extract = (offX) => {
        const temp = document.createElement('canvas'); temp.width = size; temp.height = size;
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
    const a = document.createElement('a');
    a.href = document.getElementById('final-img').src;
    a.download = `Yanahgi-${Date.now()}.png`; a.click();
};

document.getElementById('close-btn').onclick = () => {
    document.getElementById('result-modal').classList.add('hidden');
    resetBoothState();
};
