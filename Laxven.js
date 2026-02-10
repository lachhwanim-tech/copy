const spmConfig = {
    type: 'Laxven',
    columnNames: {
        time: 'Time',
        distance: 'Distance',
        speed: 'Speed',
        event: 'EventGn'
    },
    eventCodes: {
        zeroSpeed: '9G'
    },
    brakeTests: {
        GOODS: {
            bft: { minSpeed: 12, maxSpeed: 24, maxDuration: 90 * 1000 },
            bpt: { minSpeed: 35, maxSpeed: 55, maxDuration: 90 * 1000 }
        },
        COACHING: {
            bft: { minSpeed: 12, maxSpeed: 23, maxDuration: 90 * 1000 },
            bpt: { minSpeed: 55, maxSpeed: 70, maxDuration: 90 * 1000 }
        },
        MEMU: {
            bft: { minSpeed: 12, maxSpeed: 23, maxDuration: 90 * 1000 },
            bpt: { minSpeed: 55, maxSpeed: 70, maxDuration: 90 * 1000 }
        }
    }
};

// Store chart instances
let speedChartInstance = null;
let stopChartInstance = null;

/**
 * Parses the uploaded CUG CSV file and processes date/time fields.
 * @param {File} file The CUG.csv file uploaded by the user.
 * @returns {Promise<Array>} A promise that resolves with the processed CUG data.
 */
const parseAndProcessCugData = (file) => {
    return new Promise((resolve, reject) => {
        if (!file) {
            return reject(new Error('CUG file is missing.'));
        }

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            transform: (value) => value.trim(),
            complete: (result) => {
                if (result.errors.length) {
                    console.error('Errors parsing CUG.csv:', result.errors);
                    return reject(new Error('Failed to parse CUG.csv. Check file format.'));
                }
                
                const processedData = result.data.map(call => {
                    const startDateTimeStr = call['Start Date & Time']?.trim();
                    const endDateTimeStr = call['End Date & Time']?.trim();
                    const dateTimeRegex = /^(?:(\d{2})[-\/](\d{2})[-\/](\d{4})|(\d{4})[-\/](\d{2})[-\/](\d{2}))\s(\d{2}):(\d{2})(?::(\d{2}))?$/;
                    const startMatch = startDateTimeStr?.match(dateTimeRegex);
                    const endMatch = endDateTimeStr?.match(dateTimeRegex);

                    if (startMatch && endMatch) {
                        let startDateTime, endDateTime;
                        const startSeconds = startMatch[9] || '00';
                        const endSeconds = endMatch[9] || '00';

                        if (startMatch[1]) { // DD-MM-YYYY format
                            startDateTime = new Date(`${startMatch[3]}-${startMatch[2]}-${startMatch[1]}T${startMatch[7]}:${startMatch[8]}:${startSeconds}`);
                            endDateTime = new Date(`${endMatch[3]}-${endMatch[2]}-${endMatch[1]}T${endMatch[7]}:${endMatch[8]}:${endSeconds}`);
                        } else { // YYYY-MM-DD format
                            startDateTime = new Date(`${startMatch[4]}-${startMatch[5]}-${startMatch[6]}T${startMatch[7]}:${startMatch[8]}:${startSeconds}`);
                            endDateTime = new Date(`${endMatch[4]}-${endMatch[5]}-${endMatch[6]}T${endMatch[7]}:${endMatch[8]}:${endSeconds}`);
                        }

                        return {
                            ...call,
                            startDateTime,
                            endDateTime,
                            duration: parseInt(call['Duration in Sec']) || 0,
                            'CUG MOBILE NO': call['CUG MOBILE NO']?.trim()
                        };
                    }
                    console.warn('Invalid date format in CUG.csv row:', call);
                    return null;
                }).filter(call => call && call.startDateTime && !isNaN(call.startDateTime.getTime()));
                
                resolve(processedData);
            },
            error: (error) => reject(error)
        });
    });
};


document.getElementById('spmForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showToast('Processing SPM file, please wait...');
    if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(true);

    try {
        // --- NEW CODE START ---
        // Step 1: Upload the file and data to Google first.
        showToast('Uploading data and SPM file to Google Drive. This may take a moment...');
        await uploadDataAndFileToGoogle();
        showToast('Upload complete! Now analyzing the data for the report...');
        // --- NEW CODE END ---
        // Clear previous charts
        if (speedChartInstance) speedChartInstance.destroy();
        if (stopChartInstance) stopChartInstance.destroy();

        // Get form values
        const lpId = document.getElementById('lpId').value.trim();
        const lpName = document.getElementById('lpName').value.trim();
        const lpDesg = document.getElementById('lpDesg').value.trim();
        const lpGroupCli = document.getElementById('lpGroupCli').value.trim();
        const lpCugNumber = document.getElementById('lpCugNumber').value.trim();
        const alpId = document.getElementById('alpId').value.trim();
        const alpName = document.getElementById('alpName').value.trim();
        const alpDesg = document.getElementById('alpDesg').value.trim();
        const alpGroupCli = document.getElementById('alpGroupCli').value.trim();
        const alpCugNumber = document.getElementById('alpCugNumber').value.trim();
        const locoNumber = document.getElementById('locoNumber').value.trim();
        const trainNumber = document.getElementById('trainNumber').value.trim();
        const rakeType = document.getElementById('rakeType').value;
        const maxPermissibleSpeed = parseInt(document.getElementById('maxPermissibleSpeed').value);
        const section = document.getElementById('section').value;
        const fromSection = document.getElementById('fromSection').value.toUpperCase();
        const toSection = document.getElementById('toSection').value.toUpperCase();
        const routeSection = `${fromSection}-${toSection}`;
        const spmType = document.getElementById('spmType').value;
        const cliName = document.getElementById('cliName').value.trim();
        const fromDateTime = new Date(document.getElementById('fromDateTime').value);
        const toDateTime = new Date(document.getElementById('toDateTime').value);
        const spmFile = document.getElementById('spmFile').files[0];
        const cugFile = document.getElementById('cugFile').files[0];

        // Validations
        if (toDateTime <= fromDateTime) {
            throw new Error('To Date and Time must be later than From Date and Time.');
        }
        if (fromSection === toSection) {
            throw new Error('From Section and To Section cannot be the same.');
        }
        if (lpCugNumber && alpCugNumber && lpCugNumber === alpCugNumber) {
            throw new Error('LP and ALP cannot have the same CUG number. Please check the CREW.csv file.');
        }

        // Parse CUG file first and wait for it to complete
         let cugData = [];
        if (cugFile) {
            try {
                cugData = await parseAndProcessCugData(cugFile);
                console.log("Processed CUG Data:", cugData);
            } catch (error) {
                console.error("Could not process CUG file:", error);
                alert('Could not process CUG.csv file. Continuing without call analysis.');
            }
        } else {
            console.log("No CUG file uploaded. Skipping call analysis.");
        }


        const lpCalls = cugData.filter(call => {
            const matchesNumber = call['CUG MOBILE NO'] === lpCugNumber;
            const withinTime = call.startDateTime >= fromDateTime && call.startDateTime <= toDateTime;
            return matchesNumber && withinTime;
        });
        const alpCalls = cugData.filter(call => {
            const matchesNumber = call['CUG MOBILE NO'] === alpCugNumber;
            const withinTime = call.startDateTime >= fromDateTime && call.startDateTime <= toDateTime;
            return matchesNumber && withinTime;
        });

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                // --- ALL THE ORIGINAL SPM FILE PROCESSING LOGIC GOES HERE ---
                // This part remains unchanged, starting from reading the workbook
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array', cellDates: false, raw: true });
                // ... (The rest of the file processing logic is identical to the original) ...
                // The code will now correctly use the `lpCalls` and `alpCalls` variables
                // which have been populated with data.
                
                // [PASTING THE REST OF YOUR ORIGINAL CODE HERE]
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];

                const headerRow = 4;
                const range = XLSX.utils.decode_range(sheet['!ref']);
                const headers = [];
                for (let col = range.s.c; col <= range.e.c; col++) {
                    const cell = sheet[XLSX.utils.encode_cell({ c: col, r: headerRow })];
                    headers.push(cell && cell.v ? String(cell.v).trim() : '');
                }

                console.log('Excel Headers:', headers);

                const timeCol = headers.findIndex(h => h.toLowerCase().trim() === spmConfig.columnNames.time.toLowerCase());
                const distanceCol = headers.findIndex(h => h.toLowerCase().trim() === spmConfig.columnNames.distance.toLowerCase());
                const speedCol = headers.findIndex(h => h.toLowerCase().trim() === spmConfig.columnNames.speed.toLowerCase());
                const eventCol = headers.findIndex(h => h.toLowerCase().trim() === spmConfig.columnNames.event.toLowerCase());

                if (timeCol === -1 || distanceCol === -1 || speedCol === -1 || eventCol === -1) {
                    const missingCols = [];
                    if (timeCol === -1) missingCols.push(spmConfig.columnNames.time);
                    if (distanceCol === -1) missingCols.push(spmConfig.columnNames.distance);
                    if (speedCol === -1) missingCols.push(spmConfig.columnNames.speed);
                    if (eventCol === -1) missingCols.push(spmConfig.columnNames.event);
                    alert(`Missing required columns: ${missingCols.join(', ')}. Found headers: ${headers.join(', ')}. Please check the Excel file format.`);
                    if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(false);
                    return;
                }

                const jsonData = XLSX.utils.sheet_to_json(sheet, { range: headerRow + 2, header: headers, raw: true }).map(row => ({
                    Time: row[headers[timeCol]],
                    Distance: parseFloat(row[headers[distanceCol]]) || 0,
                    Speed: parseFloat(row[headers[speedCol]]) || 0,
                    EventGn: row[headers[eventCol]] ? String(row[headers[eventCol]]).trim().toUpperCase() : ''
                }));

                console.log('Raw JSON Data (first 5):', jsonData.slice(0, 5));
                // --- START: Format Auto-Detection Logic ---
// Default stoppage code ko '9G' set karein (purane format ke liye)
let stoppageEventCode = '9G';

// Check karein ki kya file mein kahin '79G' event code hai
const isNewFormat = jsonData.some(row => row.EventGn === '79G');

if (isNewFormat) {
    // Agar '79G' milta hai, to isse naya format maanein aur stoppage code badal dein
    stoppageEventCode = '79G';
    console.log("New Laxven format detected. Using '79G' as the stoppage code.");
} else {
    // Agar '79G' nahi milta hai, to purana format hi istemal karein
    console.log("Standard Laxven format detected. Using '9G' as the stoppage code.");
}
// --- END: Format Auto-Detection Logic ---

                const parsedData = jsonData.map((row, index) => {
                    let parsedTime;
                    if (typeof row.Time === 'string') {
                        const patterns = [
                            /(\d{2})[\/-](\d{2})[\/-](\d{2,4})\s*(\d{1,2}):(\d{2}):(\d{2})/,
                            /(\d{2})[\/-](\d{2})[\/-](\d{2})\s*(\d{1,2}):(\d{2})/
                        ];
                        for (const pattern of patterns) {
                            const parts = row.Time.match(pattern);
                            if (parts) {
                                let year = parseInt(parts[3]);
                                if (year < 100) year += 2000;
                                parsedTime = new Date(year, parseInt(parts[2]) - 1, parseInt(parts[1]), parseInt(parts[4]), parseInt(parts[5]), parts[6] ? parseInt(parts[6]) : 0);
                                break;
                            }
                        }
                        if (!parsedTime || isNaN(parsedTime.getTime())) {
                            console.warn(`Invalid time format at row ${index + 7}:`, row.Time);
                            return null;
                        }
                    } else {
                        console.warn(`Non-string time at row ${index + 7}:`, row.Time);
                        return null;
                    }
                    return {
                        ...row,
                        Time: parsedTime
                    };
                }).filter(row => row && row.Time && !isNaN(row.Time.getTime()));

                console.log('Parsed Data (first 10):', parsedData.slice(0, 10).map(row => ({
                    Time: row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }),
                    Speed: row.Speed,
                    Distance: row.Distance,
                    EventGn: row.EventGn
                })));

                if (parsedData.length === 0) {
                    alert('No valid data parsed from the SPM file. Please check the file format and time range.');
                    if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(false);
                    return;
                }

                const stationMap = new Map();
                window.stationSignalData
                    .filter(row => row['SECTION'] === section)
                    .forEach(row => {
                        const name = row['STATION'];
                        const distance = parseFloat(row['CUMMULATIVE DISTANT(IN Meter)']) || 0;
                        if (!stationMap.has(name)) {
                            stationMap.set(name, { name, distance });
                        }
                    });
                const stationsData = Array.from(stationMap.values());

                console.log('Stations Data for Section:', stationsData);

                const fromStation = stationsData.find(station => station.name === fromSection);
                if (!fromStation) {
                    alert(`Selected From Station (${fromSection}) is not valid for the chosen Section (${section}).`);
                    if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(false);
                    return;
                }

                const fromDistance = fromStation.distance;
                parsedData.forEach(row => {
                    row.NormalizedDistance = (row.Distance * 1000) - fromDistance;
                });

                let departureIndex = parsedData.findIndex((row, i) => {
                    if (row.Time < fromDateTime || row.Time > toDateTime || row.Speed < 1) return false;
                    let distanceMoved = 0;
                    let startDistance = row.Distance;
                    for (let j = i; j < parsedData.length; j++) {
                        const currentSpeed = parsedData[j].Speed;
                        if (currentSpeed === 0) return false;
                        distanceMoved += Math.abs(parsedData[j].Distance - startDistance);
                        startDistance = parsedData[j].Distance;
                        if (distanceMoved >= 0.2) return true;
                    }
                    return false;
                });

                if (departureIndex === -1) {
                    alert('No valid departure found in the time range (Speed >= 1 km/h with 200m continuous movement without zero speed).');
                    if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(false);
                    return;
                }

                const departureTime = parsedData[departureIndex].Time;
                console.log('Departure Time:', departureTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }));

                let filteredData = parsedData.filter(row => {
                    const rowTime = row.Time;
                    return rowTime >= departureTime && rowTime <= toDateTime && !isNaN(rowTime.getTime());
                });

                if (filteredData.length === 0) {
                    alert('No valid data found after departure.');
                    if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(false);
                    return;
                }

                console.log('Filtered Data (first 5):', filteredData.slice(0, 5).map(row => ({
                    Time: row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }),
                    Speed: row.Speed,
                    Distance: row.Distance
                })));

                const initialDistance = filteredData[0].NormalizedDistance;
                let normalizedData = filteredData.map(row => ({
                    ...row,
                    Distance: row.NormalizedDistance - initialDistance
                }));

                console.log('Normalized Data (first 5):', normalizedData.slice(0, 5));

                const fromIndex = stationsData.findIndex(station => station.name === fromSection);
                const toIndex = stationsData.findIndex(station => station.name === toSection);
                if (fromIndex === -1 || toIndex === -1) {
                    alert(`Invalid From (${fromSection}) or To (${toSection}) Station.`);
                    if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(false);
                    return;
                }

                const routeStations = [];
                const routeStartIndex = Math.min(fromIndex, toIndex);
                const endIndex = Math.max(fromIndex, toIndex);
                for (let i = routeStartIndex; i <= endIndex; i++) {
                    routeStations.push(stationsData[i]);
                }

                let normalizedStations = routeStations.map(station => ({
                    name: station.name,
                    distance: Math.abs(station.distance - fromStation.distance)
                }));

                console.log('Normalized Stations:', normalizedStations);

               const overSpeedDetails = [];
                let overSpeedGroup = null;
                normalizedData.forEach((row, index) => {
                    if (row.Speed > maxPermissibleSpeed) {
                        let sectionName = 'Unknown';
                        for (let i = 0; i < normalizedStations.length - 1; i++) {
                            const startStation = normalizedStations[i];
                            const endStation = normalizedStations[i + 1];
                            const rowDistanceM = row.Distance;
                            if (rowDistanceM >= startStation.distance && rowDistanceM < endStation.distance) {
                                sectionName = `${startStation.name}-${endStation.name}`;
                                break;
                            }
                        }

                        // Fallback logic agar station ke beech mein nahi hai (jaise station yard)
                        if (sectionName === 'Unknown') {
                            const atStationOrSignal = window.stationSignalData.find(signalRow => {
                                if (signalRow['SECTION'] !== section) return false;
                                const signalDistance = parseFloat(signalRow['CUMMULATIVE DISTANT(IN Meter)']) - fromDistance;
                                const rangeStart = signalDistance - 400;
                                const rangeEnd = signalDistance + 400;
                                return row.Distance >= rangeStart && row.Distance <= rangeEnd;
                            });
                            if (atStationOrSignal) {
                                sectionName = `${atStationOrSignal['STATION']} ${atStationOrSignal['SIGNAL NAME'] || ''}`.trim();
                            }
                        }

                  	// Naya group shuru karne ya section badalne ki logic
                    if (!overSpeedGroup || overSpeedGroup.section !== sectionName || 
                        (index > 0 && (row.Time - normalizedData[index-1].Time) > 10000)) {
                        if (overSpeedGroup) {
                            overSpeedDetails.push({
                                section: overSpeedGroup.section,
                                timeRange: `${overSpeedGroup.startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}-${overSpeedGroup.endTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`,
                                speedRange: `${overSpeedGroup.minSpeed.toFixed(2)}-${overSpeedGroup.maxSpeed.toFixed(2)}`
                            });
                        }
                        // Naya group shuru karein
                        overSpeedGroup = {
                            section: sectionName,
                            startTime: row.Time,
                            endTime: row.Time,
                            minSpeed: row.Speed,
                            maxSpeed: row.Speed
                        };
                    } else {
                        // Maujooda group ko update karein
                        overSpeedGroup.endTime = row.Time;
                        overSpeedGroup.minSpeed = Math.min(overSpeedGroup.minSpeed, row.Speed);
                        overSpeedGroup.maxSpeed = Math.max(overSpeedGroup.maxSpeed, row.Speed);
                    }
                } else {
                    // --- YAHI HAI ASLI SUDHAAR----
                    // Agar speed MPS se neeche jaati hai, toh current group ko band kar dein
                    if (overSpeedGroup) {
                        overSpeedDetails.push({
                            section: overSpeedGroup.section,
                            timeRange: `${overSpeedGroup.startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}-${overSpeedGroup.endTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`,
                            speedRange: `${overSpeedGroup.minSpeed.toFixed(2)}-${overSpeedGroup.maxSpeed.toFixed(2)}`
                        });
                        overSpeedGroup = null; // Group ko reset karein
                    }
                }
            });

            // Aakhri bacha hua group (agar hai) ko add karein
            if (overSpeedGroup) {
                overSpeedDetails.push({
                    section: overSpeedGroup.section,
                    timeRange: `${overSpeedGroup.startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}-${overSpeedGroup.endTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`,
                    speedRange: `${overSpeedGroup.minSpeed.toFixed(2)}-${overSpeedGroup.maxSpeed.toFixed(2)}`
                });
            }

            console.log('OverSpeed Details:', overSpeedDetails);

                const wheelSlipDetails = [];
                const wheelSkidDetails = [];
                let wheelSlipGroup = null;
                let wheelSkidGroup = null;

                normalizedData.forEach((row, index) => {
                    if (index === 0) return;
                    const prevRow = normalizedData[index - 1];
                    const timeDiffSec = (row.Time - prevRow.Time) / 1000;
                    if (timeDiffSec > 1) return;

                    const speedDiff = row.Speed - prevRow.Speed;
                    let sectionName = 'Unknown';
                    for (let i = 0; i < normalizedStations.length - 1; i++) {
                        const startStation = normalizedStations[i];
                        const endStation = normalizedStations[i + 1];
                        if (row.Distance >= startStation.distance && row.Distance < endStation.distance) {
                            sectionName = `${startStation.name}-${endStation.name}`;
                            break;
                        }
                    }

                    // Wheel Slip ka naya niyam: Speed 1 second mein 4 Kmph se zyada badhe
                    if (speedDiff >= 4) {
                        if (!wheelSlipGroup || wheelSlipGroup.section !== sectionName || 
                            (row.Time - prevRow.Time) > 10000) {
                            if (wheelSlipGroup) {
                                wheelSlipDetails.push({
                                    section: wheelSlipGroup.section,
                                    timeRange: `${wheelSlipGroup.startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}-${wheelSlipGroup.endTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`,
                                    speedRange: `${wheelSlipGroup.minSpeed.toFixed(2)}-${wheelSlipGroup.maxSpeed.toFixed(2)}`
                                });
                            }
                            wheelSlipGroup = {
                                section: sectionName,
                                startTime: prevRow.Time,
                                endTime: row.Time,
                                minSpeed: prevRow.Speed,
                                maxSpeed: row.Speed
                            };
                        } else {
                            wheelSlipGroup.endTime = row.Time;
                            wheelSlipGroup.maxSpeed = Math.max(wheelSlipGroup.maxSpeed, row.Speed);
                        }
                    }

                    // Wheel Skid ka naya niyam: Speed 1 second mein 5 Kmph se zyada ghate
                    if (speedDiff <= -5) {
                        if (!wheelSkidGroup || wheelSkidGroup.section !== sectionName || 
                            (row.Time - prevRow.Time) > 10000) {
                            if (wheelSkidGroup) {
                                wheelSkidDetails.push({
                                    section: wheelSkidGroup.section,
                                    timeRange: `${wheelSkidGroup.startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}-${wheelSkidGroup.endTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`,
                                    speedRange: `${wheelSkidGroup.maxSpeed.toFixed(2)}-${wheelSkidGroup.minSpeed.toFixed(2)}`
                                });
                            }
                            wheelSkidGroup = {
                                section: sectionName,
                                startTime: prevRow.Time,
                                endTime: row.Time,
                                minSpeed: row.Speed,
                                maxSpeed: prevRow.Speed
                            };
                        } else {
                            wheelSkidGroup.endTime = row.Time;
                            wheelSkidGroup.minSpeed = Math.min(wheelSkidGroup.minSpeed, row.Speed);
                        }
                    }
                });

                if (wheelSlipGroup) {
                    wheelSlipDetails.push({
                        section: wheelSlipGroup.section,
                        timeRange: `${wheelSlipGroup.startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}-${wheelSlipGroup.endTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`,
                        speedRange: `${wheelSlipGroup.minSpeed.toFixed(2)}-${wheelSlipGroup.maxSpeed.toFixed(2)}`
                    });
                }

                if (wheelSkidGroup) {
                    wheelSkidDetails.push({
                        section: wheelSkidGroup.section,
                        timeRange: `${wheelSkidGroup.startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}-${wheelSkidGroup.endTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`,
                        speedRange: `${wheelSkidGroup.maxSpeed.toFixed(2)}-${wheelSkidGroup.minSpeed.toFixed(2)}`
                    });
                }

                console.log('Wheel Slip Details:', wheelSlipDetails);
                console.log('Wheel Skid Details:', wheelSkidDetails);

                const maxPoints = 500;
                let sampledData = normalizedData;
                if (normalizedData.length > maxPoints) {
                    const step = Math.ceil(normalizedData.length / maxPoints);
                    sampledData = normalizedData.filter((_, index) => index % step === 0);
                }
                console.log('Normalized Data Length:', normalizedData.length);
                console.log('Sampled Data Length:', sampledData.length);
                let labels = sampledData.map(row => row.Time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
                let speeds = sampledData.map(row => row.Speed);
                console.log('Labels Length:', labels.length, 'Sample:', labels.slice(0, 5));
                console.log('Speeds Length:', speeds.length, 'Sample:', speeds.slice(0, 5));

                let stops = [];
                let stopGroup = 0;
                let potentialStops = [];

                for (let i = 0; i < normalizedData.length; i++) {
    const row = normalizedData[i];
    // Yahan dynamic 'stoppageEventCode' variable ka istemal kiya gaya hai
    if (row.EventGn === stoppageEventCode && row.Speed === 0) {
        potentialStops.push({
            index: i,
            time: row.Time,
            timeString: row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
            timeLabel: row.Time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
            kilometer: row.Distance
        });
    }
}

                console.log('Potential Stops:', potentialStops.length);

                const seenStops = new Set();
                let currentGroup = [];

                for (let i = 0; i < potentialStops.length; i++) {
                    currentGroup.push(potentialStops[i]);
                    const isLastInSequence = i === potentialStops.length - 1 || (() => {
                        const nextStop = potentialStops[i + 1];
                        const timeDiff = (nextStop.time - potentialStops[i].time) / 1000;
                        return timeDiff > 10;
                    })();

                    if (isLastInSequence && currentGroup.length > 0) {
                        const lastStop = currentGroup[currentGroup.length - 1];
                        const stopKey = `${lastStop.kilometer.toFixed(3)}-${lastStop.timeString}`;
                        if (!seenStops.has(stopKey)) {
                            seenStops.add(stopKey);
                            stops.push({
                                ...lastStop,
                                group: ++stopGroup
                            });
                        }
                        currentGroup = [];
                    }
                }

                stops = stops.filter((stop, index, arr) => {
                    if (index === 0) return true;
                    const prevStop = arr[index - 1];
                    const distanceDiff = Math.abs(stop.kilometer - prevStop.kilometer);
                    return distanceDiff >= 200;
                });

                stops = stops.sort((a, b) => a.time - b.time);
                stops.forEach((stop, index) => {
                    stop.group = index + 1;
                });

                console.log('Processed Stops:', stops);

                if (stops.length === 0 && !normalizedData.some(row => row.EventGn === spmConfig.eventCodes.zeroSpeed)) {
                    console.warn('No zero-speed events (9G) found in SPM file.');
                }

              // --- START: MODIFIED STOP PROCESSING WITH DURATION FILTER ---

// 1. Process potential stops to calculate duration and other details.
let processedStops = stops.map((stop, stopIndex) => { // Added stopIndex here
    const stopDistance = stop.kilometer;
    let stopLocation = '';
    let startTiming = null;
    let startTimeObject = null; // Used to calculate duration

    const atStationOrSignal = window.stationSignalData.find(row => {
        if (row['SECTION'] !== section) return false;
        const signalDistance = parseFloat(row['CUMMULATIVE DISTANT(IN Meter)']) - fromDistance;
        const rangeStart = signalDistance - 400;
        const rangeEnd = signalDistance + 400;
        return stopDistance >= rangeStart && stopDistance <= rangeEnd;
    });

    if (atStationOrSignal) {
        stopLocation = `${atStationOrSignal['STATION']} ${atStationOrSignal['SIGNAL NAME'] || ''}`.trim();
    } else {
        let sectionStart = null, sectionEnd = null;
        for (let i = 0; i < normalizedStations.length - 1; i++) {
            const startStation = normalizedStations[i];
            const endStation = normalizedStations[i + 1];
            if (stopDistance >= startStation.distance && stopDistance < endStation.distance) {
                sectionStart = startStation.name;
                sectionEnd = endStation.name;
                break;
            }
        }
        stopLocation = sectionStart && sectionEnd ? `${sectionStart}-${sectionEnd}` : 'Unknown Section';
    }

    const stopDataIndex = stop.index;
    for (let i = stopDataIndex + 1; i < normalizedData.length; i++) {
        const currentSpeed = normalizedData[i].Speed;
        const currentTime = new Date(normalizedData[i].Time);
        if (currentSpeed > 0 && currentTime > stop.time) {
            startTimeObject = currentTime;
            startTiming = currentTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            break;
        }
    }
    
    // Calculate duration in seconds
    const duration = startTimeObject ? (startTimeObject.getTime() - stop.time.getTime()) / 1000 : 0;

    // Check if this is the last stop in the potential stops array
    const isLastStopOfJourney = (stopIndex === stops.length - 1);

    // --- सुधरा हुआ 11-पॉइंट्स ब्रेकिंग और स्मूथ लॉजिक ---
    const distancesBefore = [2000, 1000, 800, 600, 500, 400, 300, 100, 50, 20, 0];
    const speedsBefore = distancesBefore.map(targetDistance => {
        let closestRow = null;
        let minDistanceDiff = Infinity;
        for (let i = stop.index; i >= 0; i--) {
            const row = normalizedData[i];
            const distanceDiff = stop.kilometer - row.Distance;
            if (distanceDiff >= targetDistance) {
                const absDiff = Math.abs(distanceDiff - targetDistance);
                if (absDiff < minDistanceDiff) {
                    minDistanceDiff = absDiff;
                    closestRow = row;
                }
            }
        }
        return closestRow ? closestRow.Speed.toFixed(2) : '0.00';
    });

    const parsedSpeeds = speedsBefore.map(speed => parseFloat(speed) || 0);

    // 11-पॉइंट एरे से सही इंडेक्स मैपिंग (SANKET_DB के लिए)
    const s2000 = parsedSpeeds[0]; // Index 0 = 2000m
    const s1000 = parsedSpeeds[1]; // Index 1 = 1000m
    const s500  = parsedSpeeds[4]; // Index 4 = 500m
    const s100  = parsedSpeeds[7]; // Index 7 = 100m
    const s50   = parsedSpeeds[8]; // Index 8 = 50m

    let isSmooth = false;
    if (rakeType === 'GOODS') {
        // नए नियम (Goods): 2000m(55), 1000m(40), 500m(25), 100m(15), 50m(10)
        isSmooth = (s2000 <= 55 && s1000 <= 40 && s500 <= 25 && s100 <= 15 && s50 <= 10);
    } else { 
        // नए नियम (Coaching/MEMU): 2000m(100), 1000m(60), 500m(50), 100m(30), 50m(15)
        isSmooth = (s2000 <= 100 && s1000 <= 60 && s500 <= 50 && s100 <= 30 && s50 <= 15);
    }
    const brakingTechnique = isSmooth ? 'Smooth' : 'Late';
    // --- सुधार समाप्त ---
    return { ...stop, stopLocation, startTiming: startTiming || 'N/A', duration, speedsBefore, brakingTechnique, isLastStopOfJourney };
});

// 2. CRITICAL CHANGE: Re-assign the 'stops' array to include stops with a duration of 10 seconds or more,
//    OR if it's the last stop of the journey.
stops = processedStops.filter(stop => stop.duration >= 10 || stop.isLastStopOfJourney);

// 3. Re-assign group numbers for the filtered stops.
stops.forEach((stop, index) => {
    stop.group = index + 1;
});

console.log('Final count of stops (duration >= 10s or last stop):', stops.length);

// --- END: MODIFIED STOP PROCESSING WITH DURATION FILTER ---
// --- START: NEW SPEED ANALYSIS FUNCTIONS ---

                /**
                 * Rake type ke aadhar par speed range mein tay ki gayi doori, percentage, aur कुल doori ka hisab lagata hai.
                 * AT MPS (Maximum Permissible Speed) ke liye ek alag row bhi add karta hai.
                 * @param {Array} data - Normalized data array.
                 * @param {string} rakeType - 'COACHING' ya 'GOODS'.
                 * @param {number} maxPermissibleSpeed - Form se select ki gayi MPS.
                 * @returns {Object} Jisme summary array aur total distance ho.
                 */
                const calculateSpeedRangeSummary = (data, rakeType, maxPermissibleSpeed) => {
                    const ranges = rakeType === 'COACHING'
                        ? {
                            'Above 130 Kmph': val => val > 130,
                            '125-130 Kmph': val => val >= 125 && val <= 130,
                            '120-125 Kmph': val => val >= 120 && val < 125,
                            '110-120 Kmph': val => val >= 110 && val < 120,
                            '90-110 Kmph': val => val >= 90 && val < 110,
                            'Below 90 Kmph': val => val < 90
                          }
                        : { // GOODS
                            'Above 80 Kmph': val => val > 80,
                            '75-80 Kmph': val => val >= 75 && val <= 80,
                            '70-75 Kmph': val => val >= 70 && val < 75,
                            '65-70 Kmph': val => val >= 65 && val < 70,
                            '60-65 Kmph': val => val >= 60 && val < 65,
                            '55-60 Kmph': val => val >= 55 && val < 60,
                            '50-55 Kmph': val => val >= 50 && val < 55,
                            '40-50 Kmph': val => val >= 40 && val < 50,
                            'Below 40 Kmph': val => val < 40
                          };

                    const distanceByRange = Object.keys(ranges).reduce((acc, key) => {
                        acc[key] = 0;
                        return acc;
                    }, {});
                    
                    let totalDistance = 0;
                    let distanceAtMPS = 0; // MPS par doori ke liye naya variable

                    for (let i = 1; i < data.length; i++) {
                        const prevPoint = data[i - 1];
                        const currPoint = data[i];

                        const distanceDiff = Math.abs(currPoint.Distance - prevPoint.Distance);
                        if (distanceDiff > 0) {
                            totalDistance += distanceDiff;
                            const avgSpeed = (prevPoint.Speed + currPoint.Speed) / 2;
                            
                            // Check karein agar speed MPS ke barabar hai
                            if (Math.round(avgSpeed) === maxPermissibleSpeed) {
                                distanceAtMPS += distanceDiff;
                            }

                            for (const rangeName in ranges) {
                                if (ranges[rangeName](avgSpeed)) {
                                    distanceByRange[rangeName] += distanceDiff;
                                    break;
                                }
                            }
                        }
                    }

                    const summary = Object.entries(distanceByRange).map(([range, distance]) => ({
                        speedRange: range,
                        distance: (distance / 1000).toFixed(2),
                        percentage: totalDistance > 0 ? ((distance / totalDistance) * 100).toFixed(2) : '0.00'
                    }));
                    
                    // AT MPS wali row ko summary list mein sabse upar add karein
                    summary.unshift({
                        speedRange: `<strong>AT MPS (${maxPermissibleSpeed} Kmph)</strong>`,
                        distance: (distanceAtMPS / 1000).toFixed(2),
                        percentage: totalDistance > 0 ? ((distanceAtMPS / totalDistance) * 100).toFixed(2) : '0.00'
                    });

                    return {
                        summary,
                        totalDistance: (totalDistance / 1000).toFixed(2)
                    };
                };

                /**
                 * Har station section ke liye average, mode, aur maximum speed nikalta hai.
                 * @param {Array} data - Normalized data array.
                 * @param {Array} stations - Normalized stations array.
                 * @param {string} fromStn - Shuruaati station ka code.
                 * @param {string} toStn - Antim station ka code.
                 * @returns {Array} Section, mode speed, max speed, aur average speed ka array.
                 */
                const calculateSectionSpeedSummary = (data, stations, fromStn, toStn) => {
                    const summary = [];
                    // Beech ke sections
                    for (let i = 0; i < stations.length - 1; i++) {
                        const startStation = stations[i];
                        const endStation = stations[i + 1];
                        const sectionName = `${startStation.name}-${endStation.name}`;

                        const sectionData = data.filter(d => d.Distance >= startStation.distance && d.Distance < endStation.distance);
                        
                        if (sectionData.length > 0) {
                            const speeds = sectionData.map(d => d.Speed).filter(s => s > 0);
                            
                            // Mode Speed Calculate Karein
                            const freq = {};
                            let maxFreq = 0;
                            let modeSpeed = 'N/A';
                            speeds.forEach(s => {
                                const speedInt = Math.floor(s);
                                freq[speedInt] = (freq[speedInt] || 0) + 1;
                                if (freq[speedInt] > maxFreq) {
                                    maxFreq = freq[speedInt];
                                    modeSpeed = speedInt;
                                }
                            });
                            
                            // Maximum and Average Speed Calculate Karein
                            const maxSpeed = speeds.length > 0 ? Math.max(...speeds).toFixed(2) : 'N/A';
                            const avgSpeed = speeds.length > 0
                                ? (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(2)
                                : 'N/A';

                            summary.push({ section: sectionName, modeSpeed, maxSpeed, averageSpeed: avgSpeed });
                        }
                    }

                    // Poore route ka summary
                    const overallSpeeds = data.map(d => d.Speed).filter(s => s > 0);
                    const overallFreq = {};
                    let overallMaxFreq = 0;
                    let overallModeSpeed = 'N/A';
                    overallSpeeds.forEach(s => {
                        const speedInt = Math.floor(s);
                        overallFreq[speedInt] = (overallFreq[speedInt] || 0) + 1;
                        if (overallFreq[speedInt] > overallMaxFreq) {
                            overallMaxFreq = overallFreq[speedInt];
                            overallModeSpeed = speedInt;
                        }
                    });
                    const overallMaxSpeed = overallSpeeds.length > 0 ? Math.max(...overallSpeeds).toFixed(2) : 'N/A';
                    const overallAvgSpeed = overallSpeeds.length > 0
                        ? (overallSpeeds.reduce((a, b) => a + b, 0) / overallSpeeds.length).toFixed(2)
                        : 'N/A';

                    summary.push({
                        section: `<strong>${fromStn}-${toStn} (Overall)</strong>`,
                        modeSpeed: overallModeSpeed,
                        maxSpeed: overallMaxSpeed,
                        averageSpeed: overallAvgSpeed
                    });

                    return summary;
                };

                // --- END: NEW SPEED ANALYSIS FUNCTIONS ---

              const trackSpeedReduction = (data, startIdx, maxDurationMs) => {
    const startSpeed = data[startIdx].Speed;
    const startTime = data[startIdx].Time.getTime();
    let lowestSpeed = startSpeed;
    let lowestSpeedIdx = startIdx;
    let speedHitZero = false;

    // --- NAYE VARIABLES: Grace period ko track karne ke liye ---
    let increaseStartTime = null;
    let speedAtIncreaseStart = 0;

    for (let i = startIdx + 1; i < data.length; i++) {
        const currentSpeed = data[i].Speed;
        const currentTime = data[i].Time.getTime();

        // Purani conditions waise hi rahengi
        if (currentTime - startTime > maxDurationMs) break;
        if (currentSpeed === 0) {
            speedHitZero = true;
            break;
        }

        // --- START: UPDATED LOGIC ---
        if (currentSpeed <= lowestSpeed) {
            // Case 1: Speed kam ho rahi hai ya sthir hai (Yeh normal hai)
            lowestSpeed = currentSpeed;
            lowestSpeedIdx = i;
            // Agar koi grace period chal raha tha, to use reset kar dein
            increaseStartTime = null;
        } else {
            // Case 2: Speed badh rahi hai, ab hum apni shartein check karenge
            
            // Agar speed badhna abhi shuru hi hua hai
            if (increaseStartTime === null) {
                increaseStartTime = currentTime; // Badhne ka samay note karein
                speedAtIncreaseStart = lowestSpeed; // Kis speed se badhna shuru hui, woh note karein
            }

            // Check karein ki limit cross hui ya nahi
            const increaseDuration = currentTime - increaseStartTime; // Kitni der se badh rahi hai
            const increaseMagnitude = currentSpeed - speedAtIncreaseStart; // Kitni zyada badh gayi hai

            if (increaseMagnitude > 2 || increaseDuration > 2000) {
                // Shart toot gayi: Ya to 2 Kmph se zyada badh gayi, ya 2 second se zyada ho gaye
                // Test ko yahin rok dein
                break;
            }
            // Agar yahan tak pahuche hain, matlab speed thodi badhi hai par limit ke andar hai.
            // Isliye loop ko chalne dein.
        }
        // --- END: UPDATED LOGIC ---
    }

    if (speedHitZero || lowestSpeedIdx === startIdx) {
        return null;
    }

    const endTime = data[lowestSpeedIdx].Time.getTime();
    return {
        index: lowestSpeedIdx,
        speed: lowestSpeed,
        timeDiff: (endTime - startTime) / 1000
    };
};

                 let bftDetails = null;
                let bptDetails = null;
                let bftMissed = false;
                let bptMissed = false;
                const brakeTestsConfig = spmConfig.brakeTests[rakeType];

                for (let i = 0; i < normalizedData.length; i++) {
                    const row = normalizedData[i];
                    const speed = row.Speed;

                    // --- BFT Check ---
                    if (!bftDetails && !bftMissed) {
                        if (speed >= brakeTestsConfig.bft.minSpeed && speed <= brakeTestsConfig.bft.maxSpeed) {
                            const result = trackSpeedReduction(normalizedData, i, brakeTestsConfig.bft.maxDuration);
                            if (result && result.timeDiff > 1) {
                                const speedReduction = speed - result.speed;
                                if (speedReduction >= 5) {
                                    bftDetails = {
                                        time: row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }),
                                        startSpeed: speed.toFixed(2),
                                        endSpeed: result.speed.toFixed(2),
                                        reduction: speedReduction.toFixed(2),
                                        timeTaken: result.timeDiff.toFixed(0),
                                        endTime: normalizedData[result.index].Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })
                                    };
                                }
                            }
                        } else if (speed > brakeTestsConfig.bft.maxSpeed) {
                            bftMissed = true; // BFT ka mauka gaya
                        }
                    }

                    // --- BPT Check ---
                   if (!bptDetails && !bptMissed) {
    if (speed >= brakeTestsConfig.bpt.minSpeed && speed <= brakeTestsConfig.bpt.maxSpeed) {
        // Yahaan 'normalizedData' ka istemaal karein
        const result = trackSpeedReduction(normalizedData, i, brakeTestsConfig.bpt.maxDuration); 
        if (result && result.timeDiff > 1) {
            const speedReduction = speed - result.speed;
            
            // Naya niyam: Speed kam se kam 40% ghatni chahiye
            const requiredReduction = speed * 0.40; 
            
            if (speedReduction >= requiredReduction) {
                bptDetails = {
                    time: row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }),
                    startSpeed: speed.toFixed(2),
                    endSpeed: result.speed.toFixed(2),
                    reduction: speedReduction.toFixed(2),
                    timeTaken: result.timeDiff.toFixed(0),
                    // Yahaan bhi 'normalizedData' ka istemaal karein
                    endTime: normalizedData[result.index].Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })
                };
            }
        }
    } else if (speed > brakeTestsConfig.bpt.maxSpeed) {
        bptMissed = true; // BPT ka mauka gaya
    }
}

                    if ((bftDetails || bftMissed) && (bptDetails || bptMissed)) {
                        break;
                    }
                }
                // Updated Crew Call Analysis
                const analyzeCalls = (calls, designation) => {
                    if (!calls || calls.length === 0) {
                        return [];
                    }
                    // This function now returns an array of objects, one for each call
                    return calls.map((call, index) => {
                        const callStart = call.startDateTime;
                        const callEnd = call.endDateTime;
                        const totalDuration = call.duration;
                        let runDuration = 0;
                        let stopDuration = 0;
                        let maxSpeed = 0;
                
                        // Compare call time with SPM data
                        for (let i = 0; i < normalizedData.length; i++) {
                            const rowTime = normalizedData[i].Time;
                            if (rowTime >= callStart && rowTime <= callEnd) {
                                if (normalizedData[i].Speed > 1) {
                                    const timeDiff = i < normalizedData.length - 1 
                                        ? (normalizedData[i + 1].Time - rowTime) / 1000 
                                        : 1;
                                    runDuration += timeDiff;
                                    maxSpeed = Math.max(maxSpeed, normalizedData[i].Speed);
                                } else {
                                    const timeDiff = i < normalizedData.length - 1 
                                        ? (normalizedData[i + 1].Time - rowTime) / 1000 
                                        : 1;
                                    stopDuration += timeDiff;
                                }
                            }
                        }
                
                        // Adjust durations to match total duration
                        const totalCalculated = runDuration + stopDuration;
                        if (totalCalculated > 0) {
                            runDuration = (runDuration / totalCalculated) * totalDuration;
                            stopDuration = (stopDuration / totalCalculated) * totalDuration;
                        } else {
                            stopDuration = totalDuration; // Default to stop if no overlap
                        }
                
                        return {
                            designation: `${designation} (Call ${index + 1})`,
                            totalDuration: totalDuration > 0 ? Math.round(totalDuration) : 'N/A',
                            runDuration: runDuration > 0 ? Math.round(runDuration) : 'N/A',
                            stopDuration: stopDuration > 0 ? Math.round(stopDuration) : 'N/A',
                            maxSpeed: runDuration > 0 ? maxSpeed.toFixed(2) : 'N/A',
                            toNumbers: call['To Mobile Number'] || 'N/A'
                        };
                    });
                };
                
                const lpCallDetails = analyzeCalls(lpCalls, lpDesg || 'LP');
                const alpCallDetails = analyzeCalls(alpCalls, alpDesg || 'ALP');
                const crewCallData = [...lpCallDetails, ...alpCallDetails];
                // ***MODIFIED PART ENDS HERE***

                const stationStops = normalizedStations.map((station, stationIndex) => {
                // Calculate total distance in KM from the normalized data
                const totalDistanceKm = normalizedData.length > 0 ? (normalizedData[normalizedData.length - 1].Distance / 1000) : 0;

                // Set tolerance based on rake type and distance
                let tolerance = 400; // Default tolerance
                if (rakeType === 'COACHING' && totalDistanceKm > 200) {
                    tolerance = 800;
                }

                const stopRangeStart = station.distance - tolerance;
                const stopRangeEnd = station.distance + tolerance;

                // Filter all potential stops within the new tolerance
                const potentialStops = stops.filter(stop => {
                    const stopDistance = stop.kilometer;
                    return stopDistance >= stopRangeStart && stopDistance <= stopRangeEnd;
                });

                // Select the latest stop if multiple are found
                let stationStop = potentialStops.length > 0 ? potentialStops[potentialStops.length - 1] : null;

                let arrivalTime = 'N/A';
                let departureTime = 'N/A';
                const timeFormat = {
                    timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false // Yahan badlav kiya gaya hai
                };
                if (stationStop) {
                    // Case 1: Agar train station par ruki thi
                    arrivalTime = stationStop.timeString;
                    departureTime = stationStop.startTiming;
                } else {
                    // Case 2: Agar train nahi ruki (passing)
                    if (stationIndex === 0 && station.name === fromSection) {
                        // Pehla station
                        departureTime = filteredData[0].Time.toLocaleString('en-IN', timeFormat);
                    } else {
                        // Beech ke stations ke liye "CROSSING" logic
                        let crossingPoint = null;
                        for (let i = 1; i < normalizedData.length; i++) {
                            const prevRow = normalizedData[i - 1];
                            const currRow = normalizedData[i];

                            // Check karein ki train ne station ki doori ko cross kiya ya nahi
                            if ((prevRow.Distance <= station.distance && currRow.Distance >= station.distance) ||
                                (prevRow.Distance >= station.distance && currRow.Distance <= station.distance)) {
                                crossingPoint = currRow; // Crossing point mil gaya
                                break;
                            }
                        }

                        if (crossingPoint) {
                            if (stationIndex === normalizedStations.length - 1) {
                                arrivalTime = crossingPoint.Time.toLocaleString('en-IN', timeFormat);
                            } else {
                                departureTime = crossingPoint.Time.toLocaleString('en-IN', timeFormat);
                            }
                        }
                    }
                }

                // Aakhri station ka departure hamesha N/A hoga
                if (stationIndex === normalizedStations.length - 1) {
                    departureTime = 'N/A';
                    // Agar aakhri station ka arrival abhi bhi N/A hai, to last point ka time lein
                    if (arrivalTime === 'N/A' && normalizedData.length > 0) {
                         const lastDataPoint = normalizedData[normalizedData.length - 1];
                         if (Math.abs(lastDataPoint.Distance - station.distance) < 2000) { // 2km ke daayre mein
                            arrivalTime = lastDataPoint.Time.toLocaleString('en-IN', timeFormat);
                         }
                    }
                }

                return {
                    station: station.name,
                    arrival: arrivalTime,
                    departure: departureTime
                };
            });

                let speedChartImage = null;
                let stopChartImage = null;

                if (labels.length === 0 || speeds.length === 0) {
                    console.warn('No valid data for Speed vs Time chart. Using fallback data.');
                    labels = ['10:00', '10:01', '10:02', '10:03', '10:04'];
                    speeds = [0, 10, 20, 15, 0];
                }

                try {
                    const ctx = document.getElementById('speedChart').getContext('2d');
                    if (!ctx) throw new Error('Speed Chart canvas not found');
                    document.getElementById('speedChart').width = 600;
                    document.getElementById('speedChart').height = 400;
                    speedChartInstance = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: labels,
                            datasets: [
                                {
                                    label: 'Speed',
                                    data: speeds,
                                    borderColor: '#00008B',
                                    backgroundColor: 'rgba(0, 0, 139, 0.1)',
                                    fill: false,
                                    tension: 0.4,
                                    borderWidth: 2,
                                    pointRadius: 0
                                }
                            ]
                        },
                        options: {
                            responsive: false,
                            scales: {
                                x: {
                                    title: { display: true, text: 'Time' },
                                    grid: { display: true, color: '#F5F5F5' },
                                    ticks: {
                                        maxTicksLimit: 12,
                                        callback: function(value, index, values) {
                                            const label = labels[index];
                                            if (stops.map(stop => stop.timeLabel).includes(label)) {
                                                return label;
                                            }
                                            return index % Math.ceil(labels.length / 12) === 0 ? label : '';
                                        }
                                    }
                                },
                                y: {
                                    title: { display: true, text: 'Speed (kmph)' },
                                    grid: { display: true, color: '#E6E6E6' },
                                    beginAtZero: true,
                                    ticks: { stepSize: 10 }
                                }
                            },
                            plugins: {
                                legend: { display: false },
                                title: { display: false }
                            }
                        }
                    });

                    speedChartImage = await new Promise((resolve) => {
                        speedChartInstance.options.animation = {
                            onComplete: () => {
                                const tempCanvas = document.createElement('canvas');
                                tempCanvas.width = 400;
                                tempCanvas.height = 600;
                                const tempCtx = tempCanvas.getContext('2d');
                                tempCtx.translate(400, 0);
                                tempCtx.rotate(Math.PI / 2);
                                const img = new Image();
                                img.src = document.getElementById('speedChart').toDataURL('image/png');
                                img.onload = () => {
                                    tempCtx.drawImage(img, 0, 0, 600, 400);
                                    resolve(tempCanvas.toDataURL('image/png'));
                                };
                            }
                        };
                        speedChartInstance.update();
                    });
                } catch (error) {
                    console.error('Error generating speed chart:', error);
                    alert('Failed to generate speed vs. time graph. Please check console logs.');
                }
                // Line 820 को इससे बदलें:
const distanceLabels = [2000, 1000, 800, 600, 500, 400, 300, 100, 50, 20, 0];
                const selectedStopsterminatedData = [];
                const selectedStops = stops.length > 10 
                    ? stops.sort(() => Math.random() - 0.5).slice(0, 10) 
                    : stops;
                console.log('Total Stops:', stops.length, 'Selected Stops:', selectedStops.length);
                const stopDatasets = selectedStops.map((stop, index) => {
                    const speeds = distanceLabels.map(targetDistance => {
                        let closestRow = null;
                        let minDistanceDiff = Infinity;
                        for (let i = stop.index; i >= 0; i--) {
                            const row = normalizedData[i];
                            const distanceDiff = stop.kilometer - row.Distance;
                            if (distanceDiff >= targetDistance) {
                                const absDiff = Math.abs(distanceDiff - targetDistance);
                                if (absDiff < minDistanceDiff) {
                                    minDistanceDiff = absDiff;
                                    closestRow = row;
                                }
                            }
                        }
                        return closestRow ? closestRow.Speed : 0;
                    });
                    console.log(`Stop ${index + 1} Speeds:`, speeds);
                    const colors = [
                        '#FF0000', '#00FF00', '#0000FF', '#FFA500', '#800080',
                        '#00FFFF', '#FF00FF', '#FFFF00', '#008080', '#FFC0CB'
                    ];
                    return {
                        label: stop.stopLocation,
                        data: speeds,
                        borderColor: colors[index % colors.length],
                        backgroundColor: 'transparent',
                        fill: false,
                        tension: 0.2,
                        borderWidth: 2,
                        pointRadius: 3
                    };
                });

                if (stopDatasets.length === 0) {
                    console.warn('No valid data for Speed vs Distance chart. Using fallback data.');
                    stopDatasets = [{
                        label: 'Test Stop',
                        data: [30, 28, 25, 20, 15, 10, 8, 5, 3, 1, 0],
                        borderColor: '#FF0000',
                        backgroundColor: 'transparent',
                        fill: false,
                        tension: 0.2,
                        borderWidth: 2,
                        pointRadius: 3
                    }];
                }

                try {
                    const stopCtx = document.getElementById('stopChart').getContext('2d');
                    if (!stopCtx) throw new Error('Stop Chart canvas not found');
                    document.getElementById('stopChart').width = 600;
                    document.getElementById('stopChart').height = 400;
                    stopChartInstance = new Chart(stopCtx, {
                        type: 'line',
                        data: {
                            labels: distanceLabels,
                            datasets: stopDatasets
                        },
                        options: {
                            responsive: false,
                            scales: {
                                x: {
                                    title: { display: true, text: 'Distance Before Stop (m)' },
                                    grid: { display: true, color: '#F5F5F5' },
                                    ticks: { stepSize: 100 }
                                },
                                y: {
                                    title: { display: true, text: 'Speed (kmph)' },
                                    grid: { display: true, color: '#E6E6E6' },
                                    beginAtZero: true,
                                    ticks: { stepSize: 10 }
                                }
                            },
                            plugins: {
                                legend: { display: true, position: 'top' },
                                title: { display: true, text: 'Speed vs. Distance Before Stop' }
                            }
                        }
                    });

                    stopChartImage = await new Promise((resolve) => {
                        stopChartInstance.options.animation = {
                            onComplete: () => {
                                const tempCanvas = document.createElement('canvas');
                                tempCanvas.width = 400;
                                tempCanvas.height = 600;
                                const tempCtx = tempCanvas.getContext('2d');
                                tempCtx.translate(400, 0);
                                tempCtx.rotate(Math.PI / 2);
                                const img = new Image();
                                img.src = document.getElementById('stopChart').toDataURL('image/png');
                                img.onload = () => {
                                    tempCtx.drawImage(img, 0, 0, 600, 400);
                                    resolve(tempCanvas.toDataURL('image/png'));
                                };
                            }
                        };
                        stopChartInstance.update();
                    });
                } catch (error) {
                    console.error('Error generating stop chart:', error);
                    alert('Failed to generate speed vs. distance chart. Please check console logs.');
                }
                 const speedRangeSummary = calculateSpeedRangeSummary(normalizedData, rakeType, maxPermissibleSpeed);
                const sectionSpeedSummary = calculateSectionSpeedSummary(normalizedData, normalizedStations, fromSection, toSection);

                // Store report data
                const reportData = {
                    trainDetails: [
                        { label: 'Loco Number', value: locoNumber || 'N/A' },
                        { label: 'Train Number', value: trainNumber || 'N/A' },
                        { label: 'Type of Rake', value: rakeType || 'N/A' },
                        { label: 'Max Permissible Speed', value: maxPermissibleSpeed ? `${maxPermissibleSpeed} kmph` : 'N/A' },
                        { label: 'Section', value: section || 'N/A' },
                        { label: 'Route', value: routeSection || 'N/A' },
                        { label: 'SPM Type', value: spmType || 'N/A' },
                        { label: 'Analysis By', value: cliName || 'N/A' },
                        { label: 'Analysis Time', value: `From ${fromDateTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })} to ${toDateTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}` }
                    ],
                    lpDetails: [
                        `LP ID: ${lpId || 'N/A'}`,
                        `LP Name: ${lpName || 'N/A'}`,
                        `Designation: ${lpDesg || 'N/A'}`,
                        `Group CLI: ${lpGroupCli || 'N/A'}`,
                        `CUG Number: ${lpCugNumber || 'N/A'}`
                    ],
                    alpDetails: [
                        `ALP ID: ${alpId || 'N/A'}`,
                        `ALP Name: ${alpName || 'N/A'}`,
                        `Designation: ${alpDesg || 'N/A'}`,
                        `Group CLI: ${alpGroupCli || 'N/A'}`,
                        `CUG Number: ${alpCugNumber || 'N/A'}`
                    ],
                    stopCount: stops.length,
                    bftDetails,
                    bptDetails,
                    crewCallData,
                    stops: stops.sort((a, b) => a.time - b.time).map((stop, index) => ({
                        group: index + 1,
                        stopLocation: stop.stopLocation,
                        timeString: stop.timeString,
                        startTiming: stop.startTiming,
                        kilometer: stop.kilometer,
                        speedsBefore: stop.speedsBefore,
                        brakingTechnique: stop.brakingTechnique
                    })),
                    stationStops,
                    overSpeedDetails,
                    wheelSlipDetails,
                    wheelSkidDetails,
                    speedRangeSummary,     // Add this line
                    sectionSpeedSummary,   // Add this line
                    speedChartImage,
                    stopChartImage,
                    speedChartConfig: {
                        labels: labels.slice(0, maxPoints),
                        speeds: speeds.slice(0, maxPoints)
                    },
                    stopChartConfig: {
                        labels: distanceLabels,
                        datasets: stopDatasets
                    }
                };

                console.log('Final reportData for Charts:', {
                    speedChartConfig: { labels: reportData.speedChartConfig.labels.length, speeds: reportData.speedChartConfig.speeds.length },
                    stopChartConfig: { labels: reportData.stopChartConfig.labels.length, datasets: reportData.stopChartConfig.datasets.length }
                });

                // Store report data in localStorage
                localStorage.setItem('spmReportData', JSON.stringify(reportData));

                // Redirect to report.html
                window.location.href = 'report.html';

                if (reportData.stopCount === 0) {
                    alert('No stops found. Please check the report and console logs.');
                }
            } catch (error) {
                console.error('Error processing SPM file:', error);
                alert('Failed to process SPM file. Please check console logs.');
                if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(false);
            }
        };
        reader.onerror = () => {
            if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(false);
            alert('Failed to read the SPM file.');
        };
        reader.readAsArrayBuffer(spmFile);

    } catch (error) {
        console.error('Error during analysis submission:', error);
        alert(`An error occurred during analysis. ${error.message}`);
        if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(false);
    }
});
