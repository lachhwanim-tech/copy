async function sendDataToGoogleSheet(data) {
    const primaryAppsScriptUrl = 'https://script.google.com/macros/s/AKfycbzNxn9uEPW4pELZjSl85jzu_KZZ1UBxgXaqSf1TAX_dsNMpOUmlWE5pNWZNwiGMdOxi/exec';
    const otherAppsScriptUrl = 'https://script.google.com/macros/s/AKfycbzNxn9uEPW4pELZjSl85jzu_KZZ1UBxgXaqSf1TAX_dsNMpOUmlWE5pNWZNwiGMdOxi/exec'; 
    const ALLOWED_HQS = ['BYT', 'R', 'RSD', 'DBEC', 'DURG', 'DRZ', 'MXA', 'BYL', 'BXA', 'AAGH', 'PPYD'];

    console.log("Preparing Clean Payload...");

    // 1. SUPER-CLEAN GET VALUE FUNCTION
    // यह फ़ंक्शन डेटा में से कचरा (", \n) हटाकर मैच करेगा
    const getVal = (arr, labels) => {
        if (!arr || !Array.isArray(arr)) return '';
        const searchLabels = Array.isArray(labels) ? labels : [labels];
        
        // Helper to clean strings: remove quotes, newlines, trim
        const clean = (str) => String(str || '').replace(/["\n\r]/g, '').trim().toLowerCase();

        const item = arr.find(d => {
            if (!d) return false;
            // Handle Object {label: "...", value: "..."}
            if (typeof d === 'object' && d.label) {
                const cleanLabel = clean(d.label);
                return searchLabels.some(l => cleanLabel.includes(clean(l)));
            }
            // Handle String "Loco No: 123"
            return searchLabels.some(l => clean(d).includes(clean(l)));
        });

        if (!item) return '';

        let result = '';
        if (typeof item === 'object') {
            result = item.value || '';
        } else {
            const strItem = String(item);
            result = strItem.includes(':') ? strItem.split(':')[1] : strItem;
        }
        // Return cleaned result (remove quotes/newlines from the value too)
        return String(result).replace(/["\n\r]/g, '').trim();
    };

    // --- 2. PREPARE DATA ---

    // A. Manual Date Formatting (No Commas allowed!)
    const now = new Date();
    const currentDateTime = 
        ('0' + now.getDate()).slice(-2) + '/' + 
        ('0' + (now.getMonth()+1)).slice(-2) + '/' + 
        now.getFullYear() + ' ' + 
        ('0' + now.getHours()).slice(-2) + ':' + 
        ('0' + now.getMinutes()).slice(-2) + ':' + 
        ('0' + now.getSeconds()).slice(-2);

    // B. From/To Station (With fallback)
    let fromStn = '';
    let toStn = '';
    // Try getting from Station List (First/Last)
    if (data.stationStops && Array.isArray(data.stationStops) && data.stationStops.length > 0) {
        fromStn = data.stationStops[0].station || '';
        toStn = data.stationStops[data.stationStops.length - 1].station || '';
    }
    // If empty, force extract from Route
    if (!fromStn || !toStn) {
        const route = getVal(data.trainDetails, ['Route', 'Section']);
        if (route && route.includes('-')) {
            const parts = route.split('-');
            if(!fromStn) fromStn = parts[0].trim();
            if(!toStn) toStn = parts[1].trim();
        }
    }

    // C. Journey Date (Logic to find Date in mixed text)
    let journeyDate = getVal(data.trainDetails, ['Journey Date', 'Date']);
    if (!journeyDate || journeyDate.length < 6) {
        // Fallback: Scan everything for a date pattern
        const dateItem = data.trainDetails.find(d => {
            const val = typeof d === 'object' ? d.value : String(d);
            return val && val.match(/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/);
        });
        if (dateItem) {
            const val = typeof dateItem === 'object' ? dateItem.value : String(dateItem);
            const matches = val.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/);
            if (matches) journeyDate = matches[0];
        }
    }
    // Ensure Date is valid
    if (!journeyDate) journeyDate = new Date().toLocaleDateString('en-GB');

    // D. Extract Other Fields
    // Use arrays for synonyms to catch variations
    let trainNo = getVal(data.trainDetails, ['Train No', 'Train Number', 'Train']);
    let locoNo = getVal(data.trainDetails, ['Loco No', 'Loco Number', 'Loco']);
    let section = getVal(data.trainDetails, ['Section']) || getVal(data.trainDetails, ['Route']);
    let rakeType = getVal(data.trainDetails, ['Type of Rake', 'Rake Type', 'Rake']);
    let mps = getVal(data.trainDetails, ['Max Permissible', 'MPS', 'Max Speed']);
    
    // Fallback for Train/Loco if they are somehow empty but present in header
    if (!locoNo && data.trainDetails[0]?.value) locoNo = data.trainDetails[0].value; // Blind guess if desperate

    let lpId = getVal(data.lpDetails, ['LP ID', 'ID']);
    let lpName = getVal(data.lpDetails, ['LP Name', 'Name']);
    let lpGroup = getVal(data.lpDetails, ['Group', 'HQ']);
    let alpId = getVal(data.alpDetails, ['ALP ID', 'ID']);
    let alpName = getVal(data.alpDetails, ['ALP Name', 'Name']);
    let alpGroup = getVal(data.alpDetails, ['Group', 'HQ']);

    // E. Stats
    let maxSpeed = '0', avgSpeed = '0';
    if (data.sectionSpeedSummary && data.sectionSpeedSummary.length > 0) {
        const overall = data.sectionSpeedSummary.find(s => s.section.includes('Overall')) || data.sectionSpeedSummary[0];
        maxSpeed = overall.maxSpeed || '0';
        avgSpeed = overall.averageSpeed || '0';
    }

    // F. Abnormalities
    const abn = {
        bft_nd: document.getElementById('chk-bft-nd')?.checked ? 1 : 0,
        bpt_nd: document.getElementById('chk-bpt-nd')?.checked ? 1 : 0,
        bft_rule: document.getElementById('chk-bft-rule')?.checked ? 1 : 0,
        bpt_rule: document.getElementById('chk-bpt-rule')?.checked ? 1 : 0,
        late_ctrl: document.getElementById('chk-late-ctrl')?.checked ? 1 : 0,
        overspeed: document.getElementById('chk-overspeed')?.checked ? 1 : 0,
        others: document.getElementById('chk-others')?.checked ? 1 : 0
    };
    const totalAbn = Object.values(abn).reduce((a, b) => a + b, 0);

    // G. Construct Text for PDF/Sheet
    const abnStrings = [];
    if (abn.bft_nd) abnStrings.push("BFT not done");
    if (abn.bpt_nd) abnStrings.push("BPT not done");
    if (abn.bft_rule) abnStrings.push(`BFT Rule: ${document.getElementById('txt-bft-rule')?.value.trim()}`);
    if (abn.bpt_rule) abnStrings.push(`BPT Rule: ${document.getElementById('txt-bpt-rule')?.value.trim()}`);
    if (abn.late_ctrl) abnStrings.push(`Late Ctrl: ${document.getElementById('txt-late-ctrl')?.value.trim()}`);
    if (abn.overspeed) abnStrings.push(`Overspeed: ${document.getElementById('txt-overspeed')?.value.trim()}`);
    if (abn.others) abnStrings.push(`Other: ${document.getElementById('txt-others')?.value.trim()}`);
    const fullAbnormalityText = abnStrings.join('; ') || 'NIL';
    
    const cliAbnormalitiesArea = document.getElementById('cliAbnormalities');
    if(cliAbnormalitiesArea) cliAbnormalitiesArea.value = fullAbnormalityText;

    // H. HQ Routing
    let storedHq = localStorage.getItem('currentSessionHq');
    if (!storedHq && document.getElementById('cliHqDisplay')) storedHq = document.getElementById('cliHqDisplay').value;
    let currentHq = storedHq ? storedHq.toString().trim().toUpperCase() : "UNKNOWN";
    let targetUrl = ALLOWED_HQS.includes(currentHq) ? primaryAppsScriptUrl : otherAppsScriptUrl;

    // --- 3. FINAL PAYLOAD (Corrected Keys & No Commas) ---
    const payload = {
        dateTime: currentDateTime, // Fixed
        cliName: getVal(data.trainDetails, ['Analysis By', 'CLI']) || data.cliName || '',
        journeyDate: journeyDate,
        trainNo: trainNo, // Should now be found due to cleaner regex
        locoNo: locoNo,   // Should now be found
        fromStn: fromStn,
        toStn: toStn,
        rakeType: rakeType,
        mps: mps,
        section: section,
        
        lpId: lpId,
        lpName: lpName,
        lpGroupCli: lpGroup,
        
        alpId: alpId,
        alpName: alpName,
        alpGroupCli: alpGroup,
        
        bftStatus: data.bftDetails?.time ? "Done" : "Not done",
        bptStatus: data.bptDetails?.time ? "Done" : "Not done",
        overspeedCount: data.overSpeedDetails ? data.overSpeedDetails.length : 0,
        totalDist: data.speedRangeSummary?.totalDistance || '0',
        avgSpeed: avgSpeed,
        maxSpeed: maxSpeed,
        
        cliObs: document.getElementById('cliRemarks')?.value.trim() || 'NIL',
        actionTaken: document.querySelector('input[name="actionTakenRadio"]:checked')?.value || 'NIL',
        
        bftNotDone: abn.bft_nd,
        bptNotDone: abn.bpt_nd,
        bftRule: abn.bft_rule,
        bptRule: abn.bpt_rule,
        lateCtrl: abn.late_ctrl,
        overspeed: abn.overspeed,
        other: abn.others,
        totalAbn: totalAbn,
        
        spare: '', 
        uniqueId: `${lpId}_${trainNo}_${journeyDate.replace(/\//g, '-')}`,
        
        stops: data.stops,
        abnormalityText: fullAbnormalityText,
        cliHq: currentHq
    };

    // --- 4. SEND ---
    try {
        await fetch(targetUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'data',
                payload: payload
            })
        });
        console.log('Data sent successfully.');
    } catch (error) {
        console.error('Submission Error:', error);
        alert('Network Error: Data could not be saved to Sheet.');
        throw error;
    }
}

// --- Event Listener ---
document.addEventListener('DOMContentLoaded', () => {
    const downloadButton = document.getElementById('downloadReport');
    const loadingOverlay = document.getElementById('loadingOverlay');

    if (downloadButton) {
        downloadButton.addEventListener('click', async () => { 
            let isValid = true;
            document.querySelectorAll('#abnormalities-checkbox-container input[type="checkbox"]:checked').forEach(chk => {
                const textId = chk.dataset.textId;
                if (textId) {
                    const textField = document.getElementById(textId);
                    if (!textField || !textField.value.trim()) {
                        alert(`Please enter a remark for the selected abnormality.`);
                        isValid = false;
                    }
                }
            });
            if (!document.querySelector('input[name="actionTakenRadio"]:checked')) {
                 alert('Please select an option for "Action Taken".');
                 isValid = false;
            }
            if (!isValid) return;

            downloadButton.disabled = true;
            downloadButton.textContent = 'Processing...';
            if(loadingOverlay) loadingOverlay.style.display = 'flex';

            const reportDataString = localStorage.getItem('spmReportData');
            if (reportDataString) {
                let reportData;
                try { reportData = JSON.parse(reportDataString); } 
                catch(e) { 
                    alert("Error retrieving data."); 
                    if(loadingOverlay) loadingOverlay.style.display = 'none';
                    return; 
                }

                try {
                    await sendDataToGoogleSheet(reportData);
                    
                    if (typeof generatePDF === 'function') {
                        await generatePDF(); 
                        alert('Data submitted and report generated. Redirecting...');
                        localStorage.removeItem('spmReportData');
                        localStorage.removeItem('currentSessionHq');
                        localStorage.removeItem('isOtherCliMode');
                        localStorage.removeItem('customCliName');
                        window.location.href = 'index.html'; 
                    } else { alert('PDF function missing.'); }
                } catch (error) { 
                    console.error("Process Error:", error);
                    alert("Error: " + error.message);
                    downloadButton.disabled = false;
                    downloadButton.textContent = 'Download Report';
                    if(loadingOverlay) loadingOverlay.style.display = 'none';
                }
            } else {
                alert('No report data found.');
                if(loadingOverlay) loadingOverlay.style.display = 'none';
            }
        }); 
    }
});
