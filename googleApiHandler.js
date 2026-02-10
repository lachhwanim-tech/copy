const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzNxn9uEPW4pELZjSl85jzu_KZZ1UBxgXaqSf1TAX_dsNMpOUmlWE5pNWZNwiGMdOxi/exec';

/**
 * Converts a file to a Base64 string.
 */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const encoded = reader.result.toString().replace(/^data:(.*,)?/, '');
            if ((encoded.length % 4) > 0) {
                encoded += '='.repeat(4 - (encoded.length % 4));
            }
            resolve(encoded);
        };
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
}

/**
 * Gathers all data from the form, converts the SPM file, and sends everything
 * to the Google Apps Script.
 * Updated: Silently handles upload errors so analysis never stops.
 */
async function uploadDataAndFileToGoogle() {
    // --- 1. DEFINE ALLOWED HQS ---
    // Note: Added extra HQs you mentioned earlier just to be safe
    const ALLOWED_HQS = ['BYT', 'R', 'RSD', 'DBEC', 'DURG', 'DRZ', 'MXA', 'BYL', 'BXA', 'AAGH', 'PPYD'];

    // Get Current HQ
    const currentHq = document.getElementById('cliHqDisplay') ? document.getElementById('cliHqDisplay').value.trim().toUpperCase() : '';

    // --- 2. CHECK IF UPLOAD SHOULD BE SKIPPED ---
    if (!ALLOWED_HQS.includes(currentHq)) {
        console.log(`CLI HQ (${currentHq}) is not in the allowed list. Skipping Google Drive Upload.`);
        return { status: 'skipped', message: 'Skipped Drive Upload for Other Division HQ.' };
    }

    try {
        // --- 3. GATHER FORM DATA ---
        const formData = {
            lpId: document.getElementById('lpId').value.trim(),
            lpName: document.getElementById('lpName').value.trim(),
            lpDesg: document.getElementById('lpDesg').value.trim(),
            lpGroupCli: document.getElementById('lpGroupCli').value.trim(),
            lpCugNumber: document.getElementById('lpCugNumber').value.trim(),
            alpId: document.getElementById('alpId').value.trim(),
            alpName: document.getElementById('alpName').value.trim(),
            alpDesg: document.getElementById('alpDesg').value.trim(),
            alpGroupCli: document.getElementById('alpGroupCli').value.trim(),
            alpCugNumber: document.getElementById('alpCugNumber').value.trim(),
            locoNumber: document.getElementById('locoNumber').value.trim(),
            trainNumber: document.getElementById('trainNumber').value.trim(),
            rakeType: document.getElementById('rakeType').value,
            maxPermissibleSpeed: document.getElementById('maxPermissibleSpeed').value,
            section: document.getElementById('section').value,
            fromSection: document.getElementById('fromSection').value.toUpperCase(),
            toSection: document.getElementById('toSection').value.toUpperCase(),
            spmType: document.getElementById('spmType').value,
            cliName: document.getElementById('cliName').value.trim(),
            cliHq: currentHq,
            fromDateTime: document.getElementById('fromDateTime').value,
            toDateTime: document.getElementById('toDateTime').value,
        };

        const spmFile = document.getElementById('spmFile').files[0];
        if (!spmFile) {
            // This isn't a network error, so we let the main code handle this validation if needed,
            // but usually index.html handles empty file checks.
            console.warn("No SPM file selected for upload.");
            return { status: 'skipped', message: 'No file to upload.' };
        }

        // --- 4. PREPARE FILE ---
        // We use a try-catch here too, just in case file reading fails
        try {
            formData.fileName = spmFile.name;
            formData.mimeType = spmFile.type || 'application/octet-stream'; 
            formData.fileContent = await fileToBase64(spmFile);
        } catch (fileError) {
            console.warn("File conversion failed, skipping upload but continuing analysis.", fileError);
            return { status: 'silent_fail', message: 'File read error, skipping upload.' };
        }

        // --- 5. UPLOAD TO DRIVE (SILENT ATTEMPT) ---
        // We wrap this fetch in a separate promise that resolves even if it fails
        // This ensures the code NEVER stops here.
        const uploadPromise = fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors', 
            body: JSON.stringify(formData)
        });

        // Optional: If you want to wait for upload, keep 'await'. 
        // If you want it super fast, remove 'await' (Fire and Forget).
        // Keeping 'await' for now to ensure data integrity, but catching errors.
        await uploadPromise;

        console.log("Upload request sent successfully.");
        return { status: 'success', message: 'Data sent to Google Sheet for processing.' };

    } catch (globalError) {
        // --- THE SILENCER ---
        // Here we catch ANY error (Network, timeout, logic).
        // We Log it for you (developer) but return "skipped" to the app so user sees no error.
        console.error("SILENT CATCH: Drive Upload Failed. Ignoring to allow Local Analysis.", globalError);
        
        return { status: 'skipped', message: 'Drive upload failed silently. Proceeding to Analysis.' };
    }
}
