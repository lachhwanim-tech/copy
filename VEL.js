const spmConfig = {
    type: 'VEL',
    columnNames: {
        date: 'Date',
        time: 'Time',
        distance: 'Inst. Distance',
        speed: 'Inst. Speed',
        event: 'Event'
    },
    eventCodes: {
        zeroSpeed: 'STOP',
        start: 'START'
    },
    brakeTests: {
        GOODS: {
            bft: { minSpeed: 14, maxSpeed: 21, maxDuration: 60 * 1000 },
            bpt: { minSpeed: 40, maxSpeed: 50, maxDuration: 60 * 1000 }
        },
        COACHING: {
            bft: { minSpeed: 14, maxSpeed: 21, maxDuration: 60 * 1000 },
            bpt: { minSpeed: 60, maxSpeed: 70, maxDuration: 60 * 1000 }
        },
        MEMU: {
            bft: { minSpeed: 14, maxSpeed: 21, maxDuration: 60 * 1000 },
            bpt: { minSpeed: 60, maxSpeed: 70, maxDuration: 60 * 1000 }
        }
    }
};

let speedChartInstance = null;
let stopChartInstance = null;

/**
 * CUG CSV file ko parse karta hai aur date/time fields ko process karta hai.
 * @param {File} file User dwara upload ki gayi CUG.csv file.
 * @returns {Promise<Array>} Ek promise jo processed CUG data ke saath resolve hota hai.
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

    // --- YEH NAYA CODE ADD KAREIN ---
   showToast('Processing SPM file, please wait...');
    if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(true);

    try {
        // Step 1: File aur data ko pehle Google Drive par upload karega.
       showToast('Uploading data and SPM file to Google Drive. This may take a moment...');
        await uploadDataAndFileToGoogle();
       showToast('Upload complete! Now analyzing the data for the report...');
    // --- YAHAN TAK KA CODE ADD KARNA HAI ---

    if (speedChartInstance) speedChartInstance.destroy();
    if (stopChartInstance) stopChartInstance.destroy();

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

    if (!spmFile.name.toLowerCase().endsWith('.pdf')) {
        alert('Please upload a .pdf file for VEL SPM.');
        window.toggleLoadingOverlay(false);
        return;
    }

    if (toDateTime <= fromDateTime) {
        alert('To Date and Time must be later than From Date and Time.');
        window.toggleLoadingOverlay(false);
        return;
    }

    if (fromSection === toSection) {
        alert('From Section and To Section cannot be the same.');
        window.toggleLoadingOverlay(false);
        return;
    }

    if (lpCugNumber === alpCugNumber && lpCugNumber !== '') {
        alert('LP and ALP cannot have the same CUG number. Please check the CREW.csv file.');
        window.toggleLoadingOverlay(false);
        return;
    }

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
            const arrayBuffer = event.target.result;
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const jsonData = [];

            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const textContent = await page.getTextContent();
                const lines = [];
                let currentLine = [];

                textContent.items.forEach(item => {
                    if (item.str.trim()) {
                        currentLine.push(item.str.trim());
                        if (item.hasEOL) {
                            lines.push(currentLine.join(' '));
                            currentLine = [];
                        }
                    }
                });

                if (currentLine.length > 0) {
                    lines.push(currentLine.join(' '));
                }

                const tableStartRegex = /^\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/;
                let isTableSection = false;

                for (const line of lines) {
                    if (tableStartRegex.test(line)) {
                        isTableSection = true;
                        const columns = line.split(/\s+/).filter(col => col.trim());
                        console.log(`Line: ${line}, Split Columns:`, columns);
                        if (columns.length >= 4) {
                            const date = columns[0];
                            const time = columns[1];
                            const distanceKm = parseFloat(columns[2]) || 0;
                            const speed = parseFloat(columns[3]) || 0;
                            let event = columns.length >= 12 ? columns[columns.length - 1] : '';
                            event = event.toUpperCase().replace(/[,]/g, '');
                            if (speed === 0 && !event.includes('STOP')) {
                                event = spmConfig.eventCodes.zeroSpeed;
                            }

                            const dateTimeStr = `${date} ${time}`;
                            const timePattern = /(\d{2})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/;
                            const match = dateTimeStr.match(timePattern);
                            let parsedTime = null;
                            if (match) {
                                const day = parseInt(match[1]);
                                const month = parseInt(match[2]) - 1;
                                const year = parseInt(match[3]);
                                const fullYear = year < 50 ? 2000 + year : 1900 + year;
                                const hours = parseInt(match[4]);
                                const minutes = parseInt(match[5]);
                                const seconds = parseInt(match[6]);
                                parsedTime = new Date(fullYear, month, day, hours, minutes, seconds);
                                console.log(`Parsed dateTime: ${dateTimeStr} -> ${parsedTime.toISOString()}`);
                            } else {
                                console.warn(`Invalid dateTime format: ${dateTimeStr}`);
                            }

                            if (parsedTime && !isNaN(parsedTime.getTime())) {
                                jsonData.push({
                                    Time: parsedTime,
                                    Distance: distanceKm * 1000,
                                    Speed: speed,
                                    Event: event
                                });
                            } else {
                                console.warn(`Skipping invalid date: ${dateTimeStr}`);
                            }
                        } else {
                            console.warn(`Insufficient columns in line: ${line}, Columns: ${columns.length}`);
                        }
                    } else if (isTableSection && /Total Dynamic Brake/.test(line)) {
                        isTableSection = false;
                    }
                }
            }

            console.log('Parsed Data (first 5):', jsonData.slice(0, 5).map(row => ({
                Time: row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata'}),
                Distance: row.Distance.toFixed(2),
                Speed: row.Speed,
                Event: row.Event
            })));

            if (jsonData.length === 0) {
                alert('No valid data parsed from the VEL SPM PDF. Please check the file format or date range.');
                window.toggleLoadingOverlay(false);
                return;
            }

            let cumulativeDistanceMeters = jsonData[0].Distance;
            const normalizedData = jsonData.map((row, index) => {
                if (index > 0) {
                    cumulativeDistanceMeters = row.Distance;
                }
                return {
                    ...row,
                    CumulativeDistance: cumulativeDistanceMeters
                };
            }).filter(row => {
                const isWithinTime = row.Time >= fromDateTime && row.Time <= toDateTime;
                if (!isWithinTime) {
                    console.log(`Filtered out row: ${row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata'})}`);
                }
                return isWithinTime;
            });

            if (normalizedData.length === 0) {
                alert('No data found within the selected time range. Please adjust the From and To Date/Time.');
                window.toggleLoadingOverlay(false);
                return;
            }

            const stationsData = window.stationSignalData
                .filter(row => row['SECTION'] === section)
                .map(row => ({
                    name: row['STATION'],
                    distance: parseFloat(row['CUMMULATIVE DISTANT(IN Meter)']) || 0,
                    signal: row['SIGNAL NAME']
                }))
                .reduce((acc, curr) => {
                    const existing = acc.find(station => station.name === curr.name);
                    if (!existing) {
                        acc.push({ name: curr.name, distance: curr.distance });
                    }
                    return acc;
                }, []);

            console.log('Stations Data for Section:', stationsData);

            const fromStation = stationsData.find(station => station.name === fromSection);
            if (!fromStation) {
                alert(`Selected From Station (${fromSection}) is not valid for the chosen Section (${section}).`);
                window.toggleLoadingOverlay(false);
                return;
            }

            const fromDistance = fromStation.distance;
            normalizedData.forEach(row => {
                row.NormalizedDistance = row.CumulativeDistance - fromDistance;
            });

            let departureIndex = normalizedData.findIndex((row, i) => {
                if (row.Time < fromDateTime || row.Time > toDateTime || row.Speed < 1) return false;
                let distanceMoved = 0;
                let startDistance = row.CumulativeDistance;
                for (let j = i; j < normalizedData.length; j++) {
                    const currentSpeed = normalizedData[j].Speed;
                    if (currentSpeed === 0) return false;
                    distanceMoved += Math.abs(normalizedData[j].CumulativeDistance - startDistance);
                    startDistance = normalizedData[j].CumulativeDistance;
                    if (distanceMoved >= 200) return true;
                }
                return false;
            });

            if (departureIndex === -1) {
                alert('No valid departure found in the time range (Speed >= 1 km/h with 200m continuous movement without zero speed).');
                window.toggleLoadingOverlay(false);
                return;
            }

            const departureTime = normalizedData[departureIndex].Time;
            console.log('Departure Time:', departureTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }));

            let filteredData = normalizedData.filter(row => {
                const rowTime = row.Time;
                return rowTime >= departureTime && rowTime <= toDateTime && !isNaN(rowTime.getTime());
            });

            if (filteredData.length === 0) {
                alert('No valid data found after departure.');
                window.toggleLoadingOverlay(false);
                return;
            }

            console.log('Filtered Data (first 5):', filteredData.slice(0, 5).map(row => ({
                Time: row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }),
                Speed: row.Speed,
                Distance: row.NormalizedDistance.toFixed(1)
            })));

            const initialDistance = filteredData[0].NormalizedDistance;
            const finalNormalizedData = filteredData.map(row => ({
                ...row,
                Distance: row.NormalizedDistance - initialDistance
            }));

            console.log('Final Normalized Data (first 5):', finalNormalizedData.slice(0, 5));

            const fromIndex = stationsData.findIndex(station => station.name === fromSection);
            const toIndex = stationsData.findIndex(station => station.name === toSection);
            if (fromIndex === -1 || toIndex === -1) {
                alert(`Invalid From (${fromSection}) or To (${toSection}) Station.`);
                window.toggleLoadingOverlay(false);
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
            // MR.js mein data 'finalNormalizedData' variable mein hai
            finalNormalizedData.forEach((row, index) => {
                // Check agar speed max permissible speed se zyada hai
                if (row.Speed > maxPermissibleSpeed) {
                    let sectionName = 'Unknown';
                    // Section ka naam pata karein
                    for (let i = 0; i < normalizedStations.length - 1; i++) {
                        const startStation = normalizedStations[i];
                        const endStation = normalizedStations[i + 1];
                        // MR mein Distance meters mein hai (finalNormalizedData ke andar)
                        if (row.Distance >= startStation.distance && row.Distance < endStation.distance) {
                            sectionName = `${startStation.name}-${endStation.name}`;
                            break;
                        }
                    }

                    // Fallback logic agar station ke beech mein nahi hai (jaise station yard)
                    if (sectionName === 'Unknown') {
                        const atStationOrSignal = window.stationSignalData.find(signalRow => {
                            if (signalRow['SECTION'] !== section) return false;
                            const signalAbsoluteDistanceCSV = parseFloat(signalRow['CUMMULATIVE DISTANT(IN Meter)']);
                            // SPM data mein distance relative hai, use absolute bana kar compare karein
                            const currentAbsoluteDistanceSPM = initialDistance + row.Distance; // initialDistance global scope se aana chahiye
                            const rangeStart = signalAbsoluteDistanceCSV - 400; // 400 meter tolerance
                            const rangeEnd = signalAbsoluteDistanceCSV + 400;
                            return currentAbsoluteDistanceSPM >= rangeStart && currentAbsoluteDistanceSPM <= rangeEnd;
                        });
                        if (atStationOrSignal) {
                            sectionName = `${atStationOrSignal['STATION']} ${atStationOrSignal['SIGNAL NAME'] || ''}`.trim();
                        }
                    }

                    // Naya group shuru karne ya section badalne ki logic
                    // Time comparison ke liye .getTime() use karein
                    if (!overSpeedGroup || overSpeedGroup.section !== sectionName ||
                        (index > 0 && (row.Time.getTime() - finalNormalizedData[index-1].Time.getTime()) > 10000)) {
                        // Agar pehle se koi group chal raha tha, use save karein
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
                    // --- YAHI HAI ASLI SUDHAAR ---
                    // Agar speed MPS se neeche jaati hai, toh current group ko band kar dein
                    if (overSpeedGroup) {
                        overSpeedDetails.push({
                            section: overSpeedGroup.section,
                            timeRange: `${overSpeedGroup.startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}-${overSpeedGroup.endTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`,
                            speedRange: `${overSpeedGroup.minSpeed.toFixed(2)}-${overSpeedGroup.maxSpeed.toFixed(2)}`
                        });
                        overSpeedGroup = null; // Group ko reset karein
                    }
                    // --- SUDHAAR KHATAM ---
                }
            });

            // Loop ke baad aakhri bacha hua group (agar hai) ko add karein
            if (overSpeedGroup) {
                overSpeedDetails.push({
                    section: overSpeedGroup.section,
                    timeRange: `${overSpeedGroup.startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}-${overSpeedGroup.endTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false})}`,
                    speedRange: `${overSpeedGroup.minSpeed.toFixed(2)}-${overSpeedGroup.maxSpeed.toFixed(2)}`
                });
            }

            console.log('OverSpeed Details:', overSpeedDetails);

            const wheelSlipDetails = [];
            const wheelSkidDetails = [];
            let wheelSlipGroup = null;
            let wheelSkidGroup = null;

            finalNormalizedData.forEach((row, index) => {
                if (index === 0) return;
                const prevRow = finalNormalizedData[index - 1];
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

            const analyzeCalls = (calls, designation) => {
                    if (!calls || calls.length === 0) {
                        return [];
                    }
                    return calls.map((call, index) => {
                        const callStart = call.startDateTime;
                        const callEnd = call.endDateTime;
                        const totalDuration = call.duration;
                        let runDuration = 0;
                        let stopDuration = 0;
                        let maxSpeed = 0;

                        for (let i = 0; i < normalizedData.length; i++) {
                            const rowTime = normalizedData[i].Time;
                            if (rowTime >= callStart && rowTime <= callEnd) {
                                const timeDiff = i < normalizedData.length - 1 ?
                                    (normalizedData[i + 1].Time - rowTime) / 1000 :
                                    1;
                                if (normalizedData[i].Speed > 1) {
                                    runDuration += timeDiff;
                                    maxSpeed = Math.max(maxSpeed, normalizedData[i].Speed);
                                } else {
                                    stopDuration += timeDiff;
                                }
                            }
                        }

                        const totalCalculated = runDuration + stopDuration;
                        if (totalCalculated > 0) {
                            runDuration = (runDuration / totalCalculated) * totalDuration;
                            stopDuration = (stopDuration / totalCalculated) * totalDuration;
                        } else {
                            stopDuration = totalDuration;
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
                console.log('Crew Call Data:', crewCallData)

            let stops = [];
            let stopGroup = 0;
            let potentialStops = [];

            for (let i = 0; i < finalNormalizedData.length; i++) {
                const row = finalNormalizedData[i];
                if (row.Speed === 0 || row.Event === spmConfig.eventCodes.zeroSpeed) {
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
            }).sort((a, b) => a.time.getTime() - b.time.getTime());

            stops.forEach((stop, index) => {
                stop.group = index + 1;
            });

           console.log('Initial stops found:', stops.length);

// --- START: MODIFIED STOP PROCESSING WITH DURATION FILTER ---

// 1. Process all potential stops to calculate their duration.
const processedStops = stops.map((stop, stopIndex) => { // Added stopIndex here
    let startTiming = null;
    let startTimeObject = null; // Used to calculate duration

    const stopDataIndex = stop.index;
    for (let i = stopDataIndex + 1; i < finalNormalizedData.length; i++) {
        const currentSpeed = finalNormalizedData[i].Speed;
        const currentTime = finalNormalizedData[i].Time;
        if (currentSpeed > 0 && currentTime > stop.time) {
            startTimeObject = currentTime;
            startTiming = currentTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            break;
        }
    }
    
    const duration = startTimeObject ? (startTimeObject.getTime() - stop.time.getTime()) / 1000 : 0;
    
    // Check if this is the last stop in the potential stops array
    const isLastStopOfJourney = (stopIndex === stops.length - 1);

    return { ...stop, startTiming: startTiming || 'N/A', duration, isLastStopOfJourney };
});

// 2. CRITICAL CHANGE: Re-assign the main 'stops' array to only include stops >= 10 seconds,
//    OR if it's the last stop of the journey.
stops = processedStops.filter(stop => stop.duration >= 10 || stop.isLastStopOfJourney);


// 3. Re-assign group numbers for the final, filtered list.
stops.forEach((stop, index) => {
    stop.group = index + 1;
});

console.log('Final count of stops (duration >= 10s or last stop):', stops.length);

// 4. Now, enhance the final list of stops with braking analysis.
const finalStops = stops.map(stop => {
    const stopDistance = stop.kilometer;
    let stopLocation = '';

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

    const distancesBefore = [1000, 800, 500, 100, 50];
    const speedsBefore = distancesBefore.map(targetDistance => {
        let closestRow = null;
        let minDistanceDiff = Infinity;
        for (let i = stop.index; i >= 0; i--) {
            const row = finalNormalizedData[i];
            const distanceDiff = stop.kilometer - row.Distance;
            if (distanceDiff >= targetDistance) {
                if (Math.abs(distanceDiff - targetDistance) < minDistanceDiff) {
                    minDistanceDiff = Math.abs(distanceDiff - targetDistance);
                    closestRow = row;
                }
            }
        }
        return closestRow ? closestRow.Speed.toFixed(2) : 'N/A';
    });
    
    // Line 919 ko isse replace karein (Yeh Sahi hai)

// Pehle sabhi speeds ko parse karein
const parsedSpeeds = speedsBefore.map(speed => parseFloat(speed) || Infinity);

// Ab, array se sahi values chunein (index ke hisaab se)
// parsedSpeeds[0] hai 1000m speed (jo logic mein nahi chahiye)
const speed800m = parsedSpeeds[1]; // 800m speed
const speed500m = parsedSpeeds[2]; // 500m speed
const speed100m = parsedSpeeds[3]; // 100m speed
const speed50m  = parsedSpeeds[4]; // 50m speed
    let isSmooth;
    if (rakeType === 'COACHING' || rakeType === 'MEMU') {
        isSmooth = speed800m <= 60 && speed500m <= 45 && speed100m <= 30 && speed50m <= 20;
    } else if (rakeType === 'GOODS') {
        isSmooth = speed800m <= 40 && speed500m <= 25 && speed100m <= 15 && speed50m <= 10;
    } else {
        isSmooth = speed800m <= 60 && speed500m <= 30 && speed100m <= 20 && speed50m <= 20;
    }

    const brakingTechnique = isSmooth ? 'Smooth' : 'Late';

    return { ...stop, stopLocation, speedsBefore, brakingTechnique };
});

// Re-assign stops to the final enhanced version
stops = finalStops;

console.log('Enhanced Stops:', stops);

// --- END: MODIFIED STOP PROCESSING ---

            // --- START: BEHTAR BRAKE TEST LOGIC ---
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

            for (let i = 0; i < finalNormalizedData.length; i++) {
                const row = finalNormalizedData[i];
                const speed = row.Speed;

                // --- BFT Check ---
                if (!bftDetails && !bftMissed) {
                    if (speed >= brakeTestsConfig.bft.minSpeed && speed <= brakeTestsConfig.bft.maxSpeed) {
                        const result = trackSpeedReduction(finalNormalizedData, i, brakeTestsConfig.bft.maxDuration);
                        if (result && result.timeDiff > 1) {
                            const speedReduction = speed - result.speed;
                            if (speedReduction >= 5) {
                                bftDetails = {
                                    time: row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }),
                                    startSpeed: speed.toFixed(2),
                                    endSpeed: result.speed.toFixed(2),
                                    reduction: speedReduction.toFixed(2),
                                    timeTaken: result.timeDiff.toFixed(0),
                                    endTime: finalNormalizedData[result.index].Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })
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
            // --- END: BEHTAR BRAKE TEST LOGIC ---

            const maxPoints = 500;
            let sampledData = finalNormalizedData;
            if (finalNormalizedData.length > maxPoints) {
                const step = Math.ceil(finalNormalizedData.length / maxPoints);
                sampledData = finalNormalizedData.filter((_, index) => index % step === 0);
            }

            const labels = sampledData.map(row => row.Time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
            const speeds = sampledData.map(row => row.Speed);

            let speedChartImage = null;
            if (labels.length === 0 || speeds.length === 0) {
                console.warn('No valid data for Speed vs Time chart. Using fallback data.');
                labels = ['10:00', '10:01', '10:02', '10:03', '10:04'];
                speeds = [0, 10, 20, 15, 0];
            }

            try {
                const ctx = document.getElementById('speedChart')?.getContext('2d');
                if (!ctx) throw new Error('Speed Chart canvas not found');
                document.getElementById('speedChart').width = 600;
                document.getElementById('speedChart').height = 400;
                speedChartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Speed',
                            data: speeds,
                            borderColor: '#00008B',
                            backgroundColor: 'rgba(0, 0, 139, 0.1)',
                            fill: false,
                            tension: 0.4,
                            borderWidth: 2,
                            pointRadius: 0
                        }]
                    },
                    options: {
                        responsive: false,
                        scales: {
                            x: {
                                title: { display: true, text: 'Time' },
                                grid: { display: true, color: '#F5F5F5' },
                                ticks: {
                                    maxTicksLimit: 12,
                                    callback: function(value, index) {
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
                                resolve(tempCanvas.toDataURL('image/png', 1.0));
                            };
                        }
                    };
                    speedChartInstance.update();
                });
            } catch (error) {
                console.error('Error generating Speed vs Time chart:', error);
                alert('Failed to generate Speed vs Time chart. Please check console logs.');
                window.toggleLoadingOverlay(false);
            }

            let stopChartImage = null;
            const distanceLabels = [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100, 0];
            const selectedStops = stops.length > 10 ? stops.slice(0, 10) : stops;

            let stopDatasets = selectedStops.map((stop, index) => {
                const speeds = distanceLabels.map(targetDistance => {
                    let closestRow = null;
                    let minDistanceDiff = Infinity;
                    for (let i = stop.index; i >= 0; i--) {
                        const row = finalNormalizedData[i];
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
                const colors = [
                    '#FF0000', '#00FF00', '#0000FF', '#FFA500', '#800080',
                    '#00FFFF', '#FF00FF', '#FFFF00', '#008080', '#FFC0CB'
                ];
                return {
                    label: stop.stopLocation || `Stop ${index + 1}`,
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
                const stopCtx = document.getElementById('stopChart')?.getContext('2d');
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
                                resolve(tempCanvas.toDataURL('image/png', 1.0));
                            };
                        }
                    };
                    stopChartInstance.update();
                });
            } catch (error) {
                console.error('Error generating Speed vs Distance chart:', error);
                alert('Failed to generate Speed vs Distance chart. Please check console logs.');
                window.toggleLoadingOverlay(false);
            }

            const stationStops = normalizedStations.map((station, stationIndex) => {
                // Calculate total distance in KM from the final normalized data
                const totalDistanceKm = finalNormalizedData.length > 0 ? (finalNormalizedData[finalNormalizedData.length - 1].Distance / 1000) : 0;

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

                if (stationStop) {
                    arrivalTime = stationStop.timeString;
                    departureTime = stationStop.startTiming;
                } else if (stationIndex === normalizedStations.length - 1 && station.name === toSection) {
                    if (finalNormalizedData.length > 0) {
                        const lastDataPoint = finalNormalizedData[finalNormalizedData.length - 1];
                        if (Math.abs(lastDataPoint.Distance - station.distance) <= 1000) {
                            arrivalTime = lastDataPoint.Time.toLocaleString('en-IN', {
                                timeZone: 'Asia/Kolkata',
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                hour12: false
                            });
                        }
                    }
                } else if (stationIndex === 0 && station.name === fromSection) {
                    if (filteredData.length > 0) {
                        departureTime = filteredData[0].Time.toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: false
                        });
                    }
                } else {
                    let closestPoint = null;
                    let minDistanceDiff = Infinity;
                    for (const row of finalNormalizedData) {
                        const distDiff = Math.abs(row.Distance - station.distance);
                        if (distDiff <= 1000 && distDiff < minDistanceDiff) {
                            minDistanceDiff = distDiff;
                            closestPoint = row;
                        }
                    }
                    if (closestPoint) {
                        if (stationIndex < normalizedStations.length - 1) {
                            departureTime = closestPoint.Time.toLocaleString('en-IN', {
                                timeZone: 'Asia/Kolkata',
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                hour12: false
                            });
                        } else {
                            arrivalTime = closestPoint.Time.toLocaleString('en-IN', {
                                timeZone: 'Asia/Kolkata',
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                hour12: false
                            });
                        }
                    }
                }

                return {
                    station: station.name,
                    arrival: arrivalTime,
                    departure: departureTime
                };
            });

            console.log('Station Stops:', stationStops);
          const speedRangeSummary = calculateSpeedRangeSummary(finalNormalizedData, rakeType, maxPermissibleSpeed);
            const sectionSpeedSummary = calculateSectionSpeedSummary(finalNormalizedData, normalizedStations, fromSection, toSection);

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
                stops: stops.map((stop, index) => ({
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
                speedRangeSummary,     // Yeh line jodein
                sectionSpeedSummary,   // Yeh line jodein
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

            try {
                localStorage.setItem('spmReportData', JSON.stringify(reportData));
                console.log('reportData saved to localStorage');
            } catch (error) {
                console.error('Error saving reportData to localStorage:', error);
                alert('Failed to save report data. Please check console logs.');
                window.toggleLoadingOverlay(false);
                return;
            }

            setTimeout(() => {
                window.location.href = 'report.html';
                window.toggleLoadingOverlay(false);
            }, 1000);

            if (reportData.stopCount === 0) {
                alert('No stops found. Please check the report and console logs.');
            }
        } catch (error) {
            console.error('Error processing VEL SPM PDF file:', error);
            alert('Failed to process VEL SPM PDF file. Please check console logs.');
            window.toggleLoadingOverlay(false);
        }
    };

    reader.onerror = () => {
        console.error('Error reading file');
        alert('Failed to read VEL SPM PDF file.');
        window.toggleLoadingOverlay(false);
    };

    reader.readAsArrayBuffer(spmFile);
    } catch (error) { // <<-- AUR AAKHIR MEIN BAS YEH ERROR BLOCK ADD HUA
        console.error('Error during submission:', error);
        alert(`An error occurred: ${error.message}`);
        if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(false);
    }
});
