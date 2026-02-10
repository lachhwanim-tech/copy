// googlesheet.js
const SCRIPT_URL = "YOUR_NEW_WEB_APP_URL_HERE"; 

async function checkForDuplicateInBank(trainNo, date) {
    if(!trainNo || !date) return;
    try {
        const res = await fetch(`${SCRIPT_URL}?action=checkDuplicate&trainNo=${trainNo}&date=${date}`);
        const json = await res.json();
        if(json.exists) {
            alert(`DATA EXISTS! Analyzed by ${json.cliName}. Contact Admin.`);
            document.getElementById('analyzeBtn').disabled = true;
        }
    } catch(e) { console.log("Offline check"); }
}

async function sendToGoogleSheet(payload) {
    await fetch(SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    });
    alert("Saved to Bank!");
}
