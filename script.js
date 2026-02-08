let peer, localStream, remoteStream, conn;
const canvas = document.getElementById('master-canvas');
const ctx = canvas.getContext('2d');

let currentStep = 0;
let totalSteps = 3; 
let isBusy = false; 

// --- PEER JS ---
const myId = Math.random().toString(36).substring(2, 8).toUpperCase();
peer = new Peer(myId);
peer.on('open', id => document.getElementById('display-id').textContent = id);
peer.on('connection', c => { conn = c; setupDataListeners(); });

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

// --- INTERACTIONS ---
document.getElementById('create-btn').onclick = async () => {
    document.getElementById('my-code-box').classList.remove('hidden');
    const stream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
    setupLocalStream(stream);
};

document.getElementById('join-btn').onclick = async () => {
    const code = document.getElementById('join-id').value.toUpperCase();
    if(!code) return alert("Enter a code!");
    try {
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
    } catch (err) { alert(err.message); }
};

function setupDataListeners() {
    conn.on('data', (data) => {
        if (data.type === 'SNAP_NEXT' && !isBusy) takeNextPhoto();
    });
}

function setupLocalStream(stream) {
    localStream = stream;
    document.getElementById('local-video').srcObject = stream;
}

function startBooth() {
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('booth-screen').classList.remove('hidden');
    const sb = document.querySelector('.sidebar');
    sb.style.display = 'flex';
    setTimeout(() => sb.classList.add('active'), 10);
    resetBoothState();
}

document.getElementById('layout-select').onchange = resetBoothState;
document.getElementById('color-select').onchange = (e) => {
    document.getElementById('blueprint').style.background = e.target.value;
};

// --- CORE LOGIC ---
document.getElementById('snap-btn').onclick = () => {
    if (isBusy) return;
    if (conn && conn.open) conn.send({ type: 'SNAP_NEXT' });
    takeNextPhoto();
};

async function takeNextPhoto() {
    if (isBusy || currentStep >= totalSteps) return;
    isBusy = true;
    
    const btn = document.getElementById('snap-btn');
    const layout = document.getElementById('layout-select').value;
    
    // VISUAL LOCK: No text, just the "busy" class
    btn.classList.add('busy');

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

    if (currentStep === 0) {
        if(layout === 'strip') { canvas.width = 700; canvas.height = 1100; }
        else if(layout === 'grid') { canvas.width = 700; canvas.height = 800; }
        else { canvas.width = 800; canvas.height = 650; }
        const paperColor = document.getElementById('color-select').value;
        ctx.fillStyle = paperColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    await captureRow(currentStep, xPos, yPos, size);
    currentStep++;

    if (currentStep >= totalSteps) {
        finishSession();
        btn.classList.remove('busy');
        btn.classList.add('done');
    } else {
        isBusy = false;
        btn.classList.remove('busy');
    }
}

async function captureRow(rowIdx, x, y, size) {
    const overlay = document.getElementById('screen-overlay');
    const timerBox = document.getElementById('timer-container');
    const countText = document.getElementById('countdown-text');
    const flash = document.getElementById('flash-layer');

    overlay.classList.remove('hidden');
    timerBox.classList.remove('hidden');

    for (let i = 3; i > 0; i--) {
        countText.innerText = i;
        await new Promise(r => setTimeout(r, 1000));
    }

    timerBox.classList.add('hidden');
    flash.classList.add('flash-trigger');
    ctx.filter = document.getElementById('filter-select').value;
    
    drawSquareCrop(document.getElementById('local-video'), x, y, size, true);
    drawSquareCrop(document.getElementById('remote-video'), x + size + 15, y, size, false);

    updateMiniPreview(rowIdx, x, y, size);
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
    ctx.fillStyle = (paper === "#2d3436") ? "white" : "#111";
    ctx.font = "300 16px Inter"; 
    ctx.textAlign = "center";
    ctx.fillText("YANAHGI // " + new Date().toLocaleDateString(), canvas.width/2, canvas.height - 40);
    document.getElementById('final-img').src = canvas.toDataURL('image/png');
    setTimeout(() => document.getElementById('result-modal').classList.remove('hidden'), 500);
}

function resetBoothState() {
    currentStep = 0;
    isBusy = false;
    const btn = document.getElementById('snap-btn');
    btn.classList.remove('busy', 'done'); // DO NOT use innerText here
    document.getElementById('blueprint').innerHTML = '';
    updateBlueprint();
}

function updateBlueprint() {
    const layout = document.getElementById('layout-select').value;
    const container = document.getElementById('blueprint');
    const rows = layout === 'strip' ? 3 : (layout === 'grid' ? 2 : 1);
    container.innerHTML = '';
    for(let i=0; i<rows; i++) {
        container.innerHTML += `<div class="slot-pair"><div class="mini-square" id="slot-${i}-L"></div><div class="mini-square" id="slot-${i}-R"></div></div>`;
    }
    container.style.background = document.getElementById('color-select').value;
}

function updateMiniPreview(row, x, y, size) {
    const l = document.getElementById(`slot-${row}-L`);
    const r = document.getElementById(`slot-${row}-R`);
    const extract = (offX) => {
        const temp = document.createElement('canvas');
        temp.width = size; temp.height = size;
        temp.getContext('2d').drawImage(canvas, offX, y, size, size, 0, 0, size, size);
        return temp.toDataURL();
    };
    if(l) l.innerHTML = `<img src="${extract(x)}">`;
    if(r) r.innerHTML = `<img src="${extract(x + size + 15)}">`;
}

document.getElementById('download-btn').onclick = () => {
    const link = document.createElement('a');
    link.href = document.getElementById('final-img').src;
    link.download = `Yanahgi-${Date.now()}.png`;
    link.click();
};

document.getElementById('close-btn').onclick = () => { 
    document.getElementById('result-modal').classList.add('hidden'); 
    resetBoothState(); 
};
