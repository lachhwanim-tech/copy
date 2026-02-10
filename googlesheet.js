// googlesheet.js - The Bridge between SANKET and Google Cloud

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxjGV2wkdd0JV1UZTLjLuwj75B4l4XanHNrM8t8vQiSaH_pwkdN_SgNHPoRCq4Q7OA3/exec'; 

/**
 * 1. DUPLICATE CHECK
 * Called from index.html when Train No/Date changes
 */
async function checkForDuplicateInBank(trainNo, journeyDate) {
    if (!trainNo || !journeyDate) return;

    const btn = document.getElementById('analyzeBtn');
    const statusMsg = document.getElementById('loadingText'); // Using loading overlay text for status momentarily if needed
    
    console.log("Checking duplicate for:", trainNo, journeyDate);

    try {
        // We send a specific 'action' parameter to the script
        const response = await fetch(`${APPS_SCRIPT_URL}?action=checkDuplicate&trainNo=${trainNo}&date=${journeyDate}`);
        const result = await response.json();

        if (result.exists) {
            alert(`STOP! This data is already analyzed by CLI ${result.cliName}. \nPlease contact CLI/TELOC M.Lachhwani (9752443479) for assistance.`);
            btn.disabled = true;
            btn.innerText = "Data Already Exists";
            btn.style.backgroundColor = "red";
        } else {
            btn.disabled = false;
            btn.innerText = "Analyze Data";
            btn.style.backgroundColor = ""; // Reset
        }
    } catch (error) {
        console.warn("Could not verify duplicate (Offline or Script Error):", error);
        // We don't block the user if internet is down, but we log it.
    }
}

/**
 * 2. FINAL SUBMISSION
 * Called from report.html
 */
async function submitFinalReport(payload, generatePdfCallback) {
    const btn = document.getElementById('btnFinalSubmit');
    btn.disabled = true;
    btn.innerText = "Saving to Bank...";

    try {
        // Prepare the POST request
        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors', // 'no-cors' is standard for Google Apps Script Web Apps sending data
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        // Since 'no-cors' doesn't return JSON, we assume success if no network error.
        // OR if you allow CORS in script, use normal mode. 
        // For safety/standard pattern:
        
        alert("Data successfully saved to Bank!");
        
        btn.innerText = "Generating PDF...";
        
        // Trigger PDF Download
        if (generatePdfCallback) {
            generatePdfCallback();
        }

        btn.innerText = "Submitted & Saved";
        
    } catch (error) {
        console.error("Submission Error:", error);
        alert("Error saving data to Google Sheet. Check internet connection.");
        btn.disabled = false;
        btn.innerText = "Final Submit";
    }
}
