let peer, localStream, remoteStream, conn;
const canvas = document.getElementById('master-canvas');
const ctx = canvas.getContext('2d');

// --- STATE MANAGEMENT ---
let currentStep = 0;
let totalSteps = 3; // Default for strip

// --- PEER JS SETUP (Standard) ---
const myId = Math.random().toString(36).substring(2, 8).toUpperCase();
peer = new Peer(myId);

peer.on('open', id => {
    document.getElementById('display-id').textContent = id;
});

peer.on('connection', (connection) => {
    conn = connection;
    setupDataListeners();
});

peer.on('call', async (call) => {
    const stream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
    setupLocalStream(stream);
    call.answer(stream);
    call.on('stream', s => { 
        remoteStream = s; 
        document.getElementById('remote-video').srcObject = s; 
        startBooth(); 
    });
});

// --- UI INTERACTIONS ---
document.getElementById('create-btn').onclick = async () => {
    document.getElementById('my-code-box').classList.remove('hidden');
    const stream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
    setupLocalStream(stream);
};

document.getElementById('join-btn').onclick = async () => {
    const code = document.getElementById('join-id').value.toUpperCase();
    if(!code) return alert("Enter a code first!");
    
    const stream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
    setupLocalStream(stream);
    
    conn = peer.connect(code);
    setupDataListeners();
    
    const call = peer.call(code, stream);
    call.on('stream', s => { 
        remoteStream = s; 
        document.getElementById('remote-video').srcObject = s; 
        startBooth(); 
    });
};

function setupDataListeners() {
    conn.on('data', (data) => {
        if (data.type === 'SNAP_NEXT') {
            takeNextPhoto();
        }
    });
}

function setupLocalStream(stream) {
    localStream = stream;
    document.getElementById('local-video').srcObject = stream;
}

function startBooth() {
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('booth-screen').classList.remove('hidden');
    
    // Show Sidebar
    const sb = document.querySelector('.sidebar');
    sb.style.display = 'flex';
    setTimeout(() => sb.classList.add('active'), 10);

    resetBoothState();
}

document.getElementById('layout-select').onchange = resetBoothState;
document.getElementById('color-select').onchange = (e) => {
    document.getElementById('blueprint').style.background = e.target.value;
};

// --- CORE LOGIC: ONE BY ONE ---
document.getElementById('snap-btn').onclick = () => {
    if (conn && conn.open) conn.send({ type: 'SNAP_NEXT' });
    takeNextPhoto();
};

async function takeNextPhoto() {
    const layout = document.getElementById('layout-select').value;
    
    // 1. DETERMINE CONFIGURATION (Do not set canvas size yet)
    let yPos = 0, xPos = 50, size = 292;
    
    if (layout === 'strip') {
        size = 292; xPos = 50;
        if(currentStep === 0) yPos = 50;
        if(currentStep === 1) yPos = 365;
        if(currentStep === 2) yPos = 680;
        totalSteps = 3;
    } else if (layout === 'grid') {
        size = 292; xPos = 50;
        if(currentStep === 0) yPos = 50;
        if(currentStep === 1) yPos = 365;
        totalSteps = 2;
    } else {
        size = 330; xPos = 65; yPos = 65;
        totalSteps = 1;
    }

    // 2. STOP if we are done
    if (currentStep >= totalSteps) return;

    // 3. INITIALIZE CANVAS (Only on the FIRST step)
    // *** THIS WAS THE FIX ***
    if (currentStep === 0) {
        if(layout === 'strip') { canvas.width = 700; canvas.height = 1100; }
        else if(layout === 'grid') { canvas.width = 700; canvas.height = 800; }
        else { canvas.width = 800; canvas.height = 650; }

        // Fill Background Color
        const paperColor = document.getElementById('color-select').value;
        ctx.fillStyle = paperColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 4. CAPTURE
    await captureRow(currentStep, xPos, yPos, size);
    
    currentStep++;

    // 5. CHECK IF FINISHED
    if (currentStep >= totalSteps) {
        finishSession();
    }
}

async function captureRow(rowIdx, x, y, size) {
    const overlay = document.getElementById('screen-overlay');
    const timerBox = document.getElementById('timer-container');
    const countText = document.getElementById('countdown-text');
    const flash = document.getElementById('flash-layer');

    // UI Feedback
    overlay.classList.remove('hidden');
    timerBox.classList.remove('hidden');

    // Countdown
    for (let i = 3; i > 0; i--) {
        countText.innerText = i;
        await new Promise(r => setTimeout(r, 1000));
    }

    timerBox.classList.add('hidden');
    flash.classList.add('flash-trigger');
    
    // Draw to Canvas
    const filter = document.getElementById('filter-select').value;
    ctx.filter = filter;
    
    drawSquareCrop(document.getElementById('local-video'), x, y, size, true);
    drawSquareCrop(document.getElementById('remote-video'), x + size + 15, y, size, false);

    // Update Sidebar Preview
    updateMiniPreview(rowIdx, x, y, size);

    // Flash End
    await new Promise(r => setTimeout(r, 400));
    flash.classList.remove('flash-trigger');
    overlay.classList.add('hidden');
}

function drawSquareCrop(video, x, y, size, mirror) {
    const vW = video.videoWidth;
    const vH = video.videoHeight;
    const m = Math.min(vW, vH);
    const sx = (vW - m) / 2;
    const sy = (vH - m) / 2;
    ctx.save();
    if (mirror) {
        ctx.translate(x + size, y);
        ctx.scale(-1, 1);
        ctx.drawImage(video, sx, sy, m, m, 0, 0, size, size);
    } else {
        ctx.drawImage(video, sx, sy, m, m, x, y, size, size);
    }
    ctx.restore();
}

function finishSession() {
    const paper = document.getElementById('color-select').value;
    ctx.filter = 'none';
    
    // Use contrasting text color
    ctx.fillStyle = (paper === "#2d3436" || paper === "#1a1a1a") ? "white" : "#111";
    
    ctx.font = "300 16px Inter"; 
    ctx.textAlign = "center";
    ctx.fillText("YANAHGI // " + new Date().toLocaleDateString(), canvas.width/2, canvas.height - 40);

    const finalImg = document.getElementById('final-img');
    finalImg.src = canvas.toDataURL('image/png');
    
    setTimeout(() => {
        document.getElementById('result-modal').classList.remove('hidden'); 
    }, 500);
}

function resetBoothState() {
    currentStep = 0;
    document.getElementById('blueprint').innerHTML = '';
    updateBlueprint();
}

function updateBlueprint() {
    const layout = document.getElementById('layout-select').value;
    const container = document.getElementById('blueprint');
    const rows = layout === 'strip' ? 3 : (layout === 'grid' ? 2 : 1);
    
    container.innerHTML = '';
    for(let i=0; i<rows; i++) {
        container.innerHTML += `
            <div class="slot-pair">
                <div class="mini-square" id="slot-${i}-L"></div>
                <div class="mini-square" id="slot-${i}-R"></div>
            </div>`;
    }
    container.style.background = document.getElementById('color-select').value;
}

function updateMiniPreview(row, x, y, size) {
    const l = document.getElementById(`slot-${row}-L`);
    const r = document.getElementById(`slot-${row}-R`);
    
    // Helper to cut out just the latest photo from main canvas
    const extract = (offX) => {
        const temp = document.createElement('canvas');
        temp.width = size; temp.height = size;
        temp.getContext('2d').drawImage(canvas, offX, y, size, size, 0, 0, size, size);
        return temp.toDataURL();
    };

    if(l) l.innerHTML = `<img src="${extract(x)}">`;
    if(r) r.innerHTML = `<img src="${extract(x + size + 15)}">`;
}

// Download & Close
document.getElementById('download-btn').onclick = () => {
    const link = document.createElement('a');
    link.href = document.getElementById('final-img').src;
    link.download = `Yanahgi-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

document.getElementById('close-btn').onclick = () => { 
    document.getElementById('result-modal').classList.add('hidden'); 
    resetBoothState(); 
};