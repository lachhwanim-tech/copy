const spmConfig = {
    type: 'Medha',
    columnNames: {
        time: 'Date,Time',
        distance: 'Dist. Mtrs',
        speed: 'Inst Kmph',
        event: 'Event'
    },
    eventCodes: {
        zeroSpeed: 'STOP'
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
        // ... baaki ka code waisa hi rahega
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

    if (!spmFile.name.toLowerCase().endsWith('.txt')) {
        alert('Please upload a .txt file for Medha SPM.');
        return;
    }

    if (toDateTime <= fromDateTime) {
        alert('To Date and Time must be later than From Date and Time.');
        return;
    }

    if (fromSection === toSection) {
        alert('From Section and To Section cannot be the same.');
        return;
    }

    if (lpCugNumber === alpCugNumber && lpCugNumber !== '') {
        alert('LP and ALP cannot have the same CUG number. Please check the CREW.csv file.');
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
            const text = event.target.result;
            const lines = text.split('\n').map(line => line.trim());
            const dataRows = [];

            const headerRegex = /^Date\s+\|\s+Time\s+\|\s+Inst\s+\|\s+Dist\.\s+\|/;
            const separatorRegex = /^_{50,}/;
            const footerRegex = /^(Total\s+Coasting|-----)/;
            let isDataSection = false;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (headerRegex.test(line) || separatorRegex.test(line) || footerRegex.test(line)) {
                    isDataSection = false;
                    continue;
                }
                if (line.match(/^\d{2}\/\d{2}\/\d{2}\s+\|/)) {
                    isDataSection = true;
                    const columns = line.split('|').map(col => col.trim());

                    if (columns.length >= 5) {
                        const baseRow = {
                            'Date': columns[0],
                            'Time': columns[1],
                            'Inst Kmph': parseInt(columns[2] || '0'),
                            'Dist. Mtrs': parseFloat(columns[3] || '0'),
                            'Event': columns[columns.length - 1] || ''
                        };

                        const dateTimeStr = `${baseRow.Date} ${baseRow.Time}`.trim();
                        const timePattern = /(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/;
                        const match = dateTimeStr.match(timePattern);
                        if (match) {
                            let year = parseInt(match[3]);
                            if (year < 100) year += 2000;
                            baseRow.time = new Date(year, parseInt(match[2]) - 1, parseInt(match[1]), 
                                                    parseInt(match[4]), parseInt(match[5]), parseInt(match[6]));
                        } else {
                            console.warn('Invalid date format at line:', line);
                            baseRow.time = new Date();
                        }

                        if (columns.length >= 14) {
                            baseRow['Coasting Km'] = parseFloat(columns[4] || '0');
                            baseRow['Coasting Sec'] = parseInt(columns[5] || '0');
                            baseRow['DB Sec'] = parseInt(columns[6] || '0');
                            baseRow['OHE KV'] = parseFloat(columns[7] || '0');
                            baseRow['OHE Amps'] = parseInt(columns[8] || '0');
                            baseRow['Power Factor'] = parseFloat(columns[9] || '0');
                            baseRow['Run Kwh'] = parseFloat(columns[10] || '0');
                            baseRow['Halt Kwh'] = parseFloat(columns[11] || '0');
                            baseRow['Total Kwh'] = parseFloat(columns[12] || '0');
                            baseRow['Event'] = columns[13] || '';
                        } else if (columns.length >= 9 && columns.slice(4, 12).some(col => col.match(/D[1-8]/))) {
                            baseRow['D1'] = columns[4] || 'Off';
                            baseRow['D2'] = columns[5] || 'Off';
                            baseRow['D3'] = columns[6] || 'Off';
                            baseRow['D4'] = columns[7] || 'Off';
                            baseRow['D5'] = columns[8] || 'Off';
                            baseRow['Event'] = columns[columns.length - 1] || '';
                        }

                        dataRows.push(baseRow);
                    } else {
                        console.warn(`Invalid data row at line ${i + 1}:`, line);
                    }
                }
            }

            if (dataRows.length === 0) {
                alert('No valid data found in the Medha SPM file. Please check the file format.');
                return;
            }

           // --- START: NAYA CODE YAHAN PASTE KAREIN ---

            let cumulativeDistanceMeters = 0;
            let jsonDataWithRecalculatedDistance = [];

            // Har row ke liye loop chala kar nayi distance calculate karein
            for (let i = 0; i < dataRows.length; i++) {
                const row = dataRows[i];
                const time = row.time;
                const speedKmph = parseFloat(row['Inst Kmph']) || 0;
                const event = (row.Event || '').toUpperCase();

                if (i > 0) {
                    const prevRow = dataRows[i - 1];
                    const prevTime = prevRow.time;
                    const timeDiffSeconds = (time.getTime() - prevTime.getTime()) / 1000;

                    if (timeDiffSeconds > 0 && timeDiffSeconds < 10) {
                        const prevSpeedKmph = parseFloat(prevRow['Inst Kmph']) || 0;
                        const avgSpeedMps = ((speedKmph + prevSpeedKmph) / 2) * (1000 / 3600);
                        const distanceTraveled = avgSpeedMps * timeDiffSeconds;
                        cumulativeDistanceMeters += distanceTraveled;
                    }
                }

                jsonDataWithRecalculatedDistance.push({
                    Time: time,
                    Speed: speedKmph,
                    CumulativeDistance: cumulativeDistanceMeters, // Apni calculate ki hui distance istemaal karein
                    Event: event
                });
            }

            // Ab user ke diye gaye time range mein data filter karein
            const jsonData = jsonDataWithRecalculatedDistance.filter(row =>
                row && row.Time && !isNaN(row.Time.getTime()) &&
                row.Time >= fromDateTime && row.Time <= toDateTime
            );

            if (jsonData.length === 0) {
                alert('No valid data found within the selected time range. Please check the SPM file or time inputs.');
                return;
            }

            console.log('Processed data with RECALCULATED distance (first 5):', jsonData.slice(0, 5));

            // stationsData ko yahaan define karein
            const stationsData = window.stationSignalData
                .filter(row => row['SECTION'] === section)
                .map(row => ({
                    name: row['STATION'],
                    distance: parseFloat(row['CUMMULATIVE DISTANT(IN Meter)']) || 0,
                    signal: row['SIGNAL NAME']
                }))
                .reduce((acc, curr) => {
                    const existing = acc.find(station_row => station_row.name === curr.name);
                    if (!existing) {
                        acc.push({ name: curr.name, distance: curr.distance });
                    }
                    return acc;
                }, []);

            console.log('Stations Data for Section:', stationsData);

            const fromStation = stationsData.find(station => station.name === fromSection);
            const toStation = stationsData.find(station => station.name === toSection);

            // Nayi calculate ki hui distance se variable ko define karein
            const calculatedTotalDistanceKm = jsonData.length > 0 ? jsonData[jsonData.length - 1].CumulativeDistance / 1000 : 0;
            console.log(`Recalculated Total Distance: ${calculatedTotalDistanceKm.toFixed(3)} km`);

            // Ab dono distance ko validate karein
            if (fromStation && toStation) {
                const expectedDistanceKm = Math.abs(toStation.distance - fromStation.distance) / 1000;
                console.log(`Expected Distance (${fromSection} to ${toSection}): ${expectedDistanceKm.toFixed(3)} km`);
                if (Math.abs(calculatedTotalDistanceKm - expectedDistanceKm) > 5) { // 5km ka margin rakha hai
                    console.warn(`Distance mismatch: Recalculated ${calculatedTotalDistanceKm.toFixed(3)} km vs Expected ${expectedDistanceKm.toFixed(3)} km`);
                }
            }
            // --- END: NAYA CODE YAHAN KHATAM ---
            if (!fromStation) {
                alert('Selected From Station is not valid for the chosen Section.');
                return;
            }

            const fromDistance = jsonData.length > 0 ? jsonData[0].CumulativeDistance : 0;
            jsonData.forEach(row => {
                row.NormalizedDistance = (row.CumulativeDistance - fromDistance) / 1000;
            });

            let departureIndex = jsonData.findIndex((row, i) => {
                if (row.Time > toDateTime || row.Speed <= 1) return false;
                let distanceMoved = 0;
                let startDistance = row.CumulativeDistance;
                for (let j = i; j < jsonData.length; j++) {
                    const currentSpeed = jsonData[j].Speed;
                    if (currentSpeed === 0) return false;
                    distanceMoved += Math.abs(jsonData[j].CumulativeDistance - startDistance);
                    startDistance = jsonData[j].CumulativeDistance;
                    if (distanceMoved >= 200) {
                        return row.Time >= fromDateTime;
                    }
                }
                return false;
            });

            if (departureIndex === -1) {
                alert('No valid departure found in the selected time range (Speed >= 1 km/h with 200m continuous movement).');
                return;
            }
            // --- AAP APNA NAYA CODE YAHAN DAAL SAKTE HAIN ---
            const departureAbsoluteSPMDistance = jsonData[departureIndex].CumulativeDistance;
            const fromStationAbsoluteCSVDistance = fromStation.distance;
            const distanceOffset = fromStationAbsoluteCSVDistance - departureAbsoluteSPMDistance;
            // ---
            const departureTime = jsonData[departureIndex].Time;
            console.log('Departure Time:', departureTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }));

            let filteredData = jsonData.filter(row => {
                const rowTime = row.Time;
                return rowTime >= departureTime && rowTime <= toDateTime && !isNaN(rowTime.getTime());
            });
            

            if (filteredData.length === 0) {
                alert('No valid data found after departure within the selected time range.');
                return;
            }

            console.log('Filtered Data (first 5):', filteredData.slice(0, 5).map(row => ({
                Time: row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }),
                Speed: row.Speed,
                Distance: row.CumulativeDistance.toFixed(2)
            })));

            const initialDistance = filteredData.length > 0 ? filteredData[0].CumulativeDistance : 0;
            let normalizedData = filteredData.map(row => ({
                ...row,
                // Main distance property: METERS mein, starting point se relative.
                Distance: row.CumulativeDistance - initialDistance
            }));

            console.log('Normalized Data (first 5, distance in meters):', normalizedData.slice(0, 5).map(r => ({...r, Distance: r.Distance.toFixed(2)})));

            const fromIndex = stationsData.findIndex(station => station.name === fromSection);
            const toIndex = stationsData.findIndex(station => station.name === toSection);
            if (fromIndex === -1 || toIndex === -1) {
                alert('From or To Station is invalid.');
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
                // Check agar speed max permissible speed se zyada hai
                if (row.Speed > maxPermissibleSpeed) {
                    let sectionName = 'Unknown';
                    // Section ka naam pata karein
                    for (let i = 0; i < normalizedStations.length - 1; i++) {
                        const startStation = normalizedStations[i];
                        const endStation = normalizedStations[i + 1];
                        // Medha mein Distance meters mein hai
                        if (row.Distance >= startStation.distance && row.Distance < endStation.distance) {
                            sectionName = `${startStation.name}-${endStation.name}`;
                            break;
                        }
                    }

                    // Fallback logic agar station ke beech mein nahi hai (jaise station yard)
                    if (sectionName === 'Unknown') {
                        const atStationOrSignal = window.stationSignalData.find(signalRow => {
                            if (signalRow['SECTION'] !== section) return false;
                            // Station/Signal data mein distance meters mein hoti hai
                            const signalAbsoluteDistanceCSV = parseFloat(signalRow['CUMMULATIVE DISTANT(IN Meter)']);
                            // SPM data mein bhi Distance meters mein hai (normalizedData ke andar)
                            // InitialDistance ko dhyan mein rakh kar absolute distance calculate karein
                            const currentAbsoluteDistanceSPM = initialDistance + row.Distance;
                            const rangeStart = signalAbsoluteDistanceCSV - 400; // 400 meter tolerance
                            const rangeEnd = signalAbsoluteDistanceCSV + 400;
                            return currentAbsoluteDistanceSPM >= rangeStart && currentAbsoluteDistanceSPM <= rangeEnd;
                        });
                        if (atStationOrSignal) {
                            sectionName = `${atStationOrSignal['STATION']} ${atStationOrSignal['SIGNAL NAME'] || ''}`.trim();
                        }
                    }


                    // Naya group shuru karne ya section badalne ki logic
                    if (!overSpeedGroup || overSpeedGroup.section !== sectionName ||
                        (index > 0 && (row.Time.getTime() - normalizedData[index-1].Time.getTime()) > 10000)) { // Use .getTime() for comparison
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
            let wheelSlipGroup = null;
            normalizedData.forEach((row, index) => {
                if (index === 0) return;
                const prevRow = normalizedData[index - 1];
                const timeDiffSec = (row.Time.getTime() - prevRow.Time.getTime()) / 1000;
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

                if (speedDiff >= 4) {
                    if (!wheelSlipGroup || wheelSlipGroup.section !== sectionName || 
                        (row.Time.getTime() - prevRow.Time.getTime()) > 10000) {
                        if (wheelSlipGroup) {
                            wheelSlipDetails.push({
                                section: wheelSlipGroup.section,
                                timeRange: `${wheelSlipGroup.startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}-${wheelSlipGroup.endTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}`,
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
            });

            if (wheelSlipGroup) {
                wheelSlipDetails.push({
                    section: wheelSlipGroup.section,
                    timeRange: `${wheelSlipGroup.startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}-${wheelSlipGroup.endTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false})}`,
                    speedRange: `${wheelSlipGroup.minSpeed.toFixed(2)}-${wheelSlipGroup.maxSpeed.toFixed(2)}`
                });
            }

            console.log('Wheel Slip Details:', wheelSlipDetails);

            const wheelSkidDetails = [];
            let wheelSkidGroup = null;
            normalizedData.forEach((row, index) => {
                if (index === 0) return;
                const prevRow = normalizedData[index - 1];
                const timeDiffSec = (row.Time.getTime() - prevRow.Time.getTime()) / 1000;
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

                if (speedDiff <= -5) {
                    if (!wheelSkidGroup || wheelSkidGroup.section !== sectionName || 
                        (row.Time.getTime() - prevRow.Time.getTime()) > 10000) {
                        if (wheelSkidGroup) {
                            wheelSkidDetails.push({
                                section: wheelSkidGroup.section,
                                timeRange: `${wheelSkidGroup.startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}-${wheelSkidGroup.endTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false})}`,
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

            if (wheelSkidGroup) {
                wheelSkidDetails.push({
                    section: wheelSkidGroup.section,
                    timeRange: `${wheelSkidGroup.startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}-${wheelSkidGroup.endTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}`,
                    speedRange: `${wheelSkidGroup.maxSpeed.toFixed(2)}-${wheelSkidGroup.minSpeed.toFixed(2)}`
                });
            }

            console.log('Wheel Skid Details:', wheelSkidDetails);

            // =================================================================
            // == UPDATED CREW CALL ANALYSIS SECTION ==
            // =================================================================
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

            const maxPoints = 1000;
            let sampledData = normalizedData;
            if (normalizedData.length > maxPoints) {
                const step = Math.ceil(normalizedData.length / maxPoints);
                sampledData = normalizedData.filter((_, index) => index % step === 0);
            }

           const labels = sampledData.map(row => row.Time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
            const speeds = sampledData.map(row => row.Speed);

            let stops = [];
            let stopGroup = 0;
            let potentialStops = [];

           for (let i = 0; i < normalizedData.length; i++) {
                const row = normalizedData[i];
                // Check if the event signifies zero speed AND the speed is actually 0
                if (row.Event === spmConfig.eventCodes.zeroSpeed && row.Speed === 0) {
                    potentialStops.push({
                        index: i,
                        time: row.Time,
                        // --- THIS IS THE LINE TO CHANGE ---
                        timeString: row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }), // Set hour12 to false
                        timeLabel: row.Time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }), // Also update label if needed
                        kilometer: row.Distance // Use relative distance in meters
                    });
                }
            }

            console.log('Potential Stops:', potentialStops);

            const seenStops = new Set();
            let currentGroup = [];

            for (let i = 0; i < potentialStops.length; i++) {
                currentGroup.push(potentialStops[i]);
                const isLastInSequence = i === potentialStops.length - 1 || (() => {
                    const nextStop = potentialStops[i + 1];
                    const timeDiff = (nextStop.time.getTime() - potentialStops[i].time.getTime()) / 1000;
                    return timeDiff > 10;
                })();

                if (isLastInSequence && currentGroup.length > 0) {
                    const lastStop = currentGroup[currentGroup.length - 1];
                    const stopKey = `${lastStop.kilometer.toFixed(2)}-${lastStop.timeString}`;
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
                const distanceDiff = Math.abs(stop.kilometer - prevStop.kilometer) / 1000;
                return distanceDiff >= 0.2;
            });

            stops.sort((a, b) => a.time.getTime() - b.time.getTime());

           console.log('Sorted Stops:', stops);

                if (stops.length === 0 && !normalizedData.some(row => row.Event === spmConfig.eventCodes.zeroSpeed)) {
                    alert(`No ${spmConfig.eventCodes.zeroSpeed} (ZeroSpeed) event found. Please check the SPM file.`);
                }

               // --- START: MODIFIED STOP PROCESSING WITH DURATION FILTER ---

// 1. Process potential stops to calculate duration and other details.
const processedStops = stops.map((stop, stopIndex) => { // Added stopIndex here
    let startTiming = null;
    let startTimeObject = null; // Used to calculate duration

    const stopDataIndex = stop.index;
    for (let i = stopDataIndex + 1; i < normalizedData.length; i++) {
        const currentSpeed = normalizedData[i].Speed;
        const currentTime = new Date(normalizedData[i].Time);
        if (currentSpeed > 0 && currentTime.getTime() > stop.time.getTime()) {
            startTimeObject = currentTime;
            startTiming = currentTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            break;
        }
    }
    
    // Calculate duration in seconds
    const duration = startTimeObject ? (startTimeObject.getTime() - stop.time.getTime()) / 1000 : 0;

    // Check if this is the last stop in the potential stops array
    const isLastStopOfJourney = (stopIndex === stops.length - 1);

    return { ...stop, startTiming: startTiming || 'N/A', duration, isLastStopOfJourney };
});

// 2. CRITICAL CHANGE: Re-assign the 'stops' array to include stops with a duration of 10 seconds or more,
//    OR if it's the last stop of the journey.
stops = processedStops.filter(stop => stop.duration >= 10 || stop.isLastStopOfJourney);

// 3. Re-assign group numbers for the filtered stops.
stops.forEach((stop, index) => {
    stop.group = index + 1;
});

console.log('Final count of stops (duration >= 10s or last stop):', stops.length);

// 4. Now, enhance the final list of stops with braking analysis and correct location.
const finalStops = stops.map(stop => {
    // (The rest of the logic for location, braking technique, etc. remains the same)
    const absoluteStopSPMDistance = initialDistance + stop.kilometer;
    const alignedStopDistanceCSV = absoluteStopSPMDistance + distanceOffset;
    let stopLocation = '';

    const atStationOrSignal = window.stationSignalData.find(row => {
        if (row['SECTION'] !== section) return false;
        const signalAbsoluteDistanceCSV = parseFloat(row['CUMMULATIVE DISTANT(IN Meter)']);
        const rangeStart = signalAbsoluteDistanceCSV - 200;
        const rangeEnd = signalAbsoluteDistanceCSV + 200;
        return alignedStopDistanceCSV >= rangeStart && alignedStopDistanceCSV <= rangeEnd;
    });

    if (atStationOrSignal) {
        stopLocation = `${atStationOrSignal['STATION']} ${atStationOrSignal['SIGNAL NAME'] || ''}`.trim();
    } else {
        let sectionStart = null, sectionEnd = null;
        for (let i = 0; i < routeStations.length - 1; i++) {
            const startStation = routeStations[i];
            const endStation = routeStations[i + 1];
            if (alignedStopDistanceCSV >= startStation.distance && alignedStopDistanceCSV < endStation.distance) {
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
        return closestRow ? Math.floor(closestRow.Speed).toString() : 'N/A';
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
            // --- END: BEHTAR BRAKE TEST LOGIC ---
           // --- START: NAYA STATION TIMING CODE YAHAN PASTE KAREIN ---
// --- START: NAYA STATION TIMING CODE YAHAN PASTE KAREIN ---
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
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    };

    if (stationStop) {
        // Case 1: Agar train station par ruki thi
        // MODIFICATION: Format the arrival time consistently using the timeFormat object.
        arrivalTime = stationStop.time.toLocaleString('en-IN', timeFormat);
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

console.log('Station Stops:', stationStops);
            document.getElementById('speedChart').width = 600;
            document.getElementById('speedChart').height = 400;

            let speedChartImage = null;
            if (labels.length === 0 || speeds.length === 0) {
                alert('No valid data available for the time vs. speed graph. Please check console logs.');
                return;
            }

            try {
                const ctx = document.getElementById('speedChart').getContext('2d');
                ctx.clearRect(0, 0, 600, 400);
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
                            img.src = document.getElementById('speedChart').toDataURL('image/png', 1.0);
                            img.onload = () => {
                                tempCtx.drawImage(img, 0, 0, 600, 400);
                                resolve(tempCanvas.toDataURL('image/png', 1.0));
                            };
                        }
                    };
                    speedChartInstance.update();
                });
            } catch (error) {
                console.error('Error generating time vs. speed chart:', error);
                alert('Failed to generate time vs. speed graph. Please check console logs.');
                return;
            }

            let stopChartImage = null;
            const distanceLabels = [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100, 0];

            const selectedStops = stops.length > 10 
                ? stops.slice(0, 10)
                : stops;

            const stopDatasets = selectedStops.map((stop, index) => {
                const speeds = distanceLabels.map(targetDistance => { // targetDistance METERS mein hai
                    let closestRow = null;
                    let minDistanceDiff = Infinity;
                    for (let i = stop.index; i >= 0; i--) {
                        const row = normalizedData[i];
                        // Yahaan bhi relative meters vs relative meters compare hoga.
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

            if (stopDatasets.length > 0) {
                try {
                    const stopCanvas = document.createElement('canvas');
                    stopCanvas.id = 'stopChart_' + Date.now();
                    stopCanvas.width = 600;
                    stopCanvas.height = 400;
                    stopCanvas.style.display = 'none';
                    document.body.appendChild(stopCanvas);
                    const stopCtx = stopCanvas.getContext('2d');
                    stopCtx.clearRect(0, 0, 600, 400);
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
                                img.src = stopCanvas.toDataURL('image/png', 1.0);
                                img.onload = () => {
                                    tempCtx.drawImage(img, 0, 0, 600, 400);
                                    const dataUrl = tempCanvas.toDataURL('image/png', 1.0);
                                    console.log('Stop Chart Image generated:', dataUrl.substring(0, 50) + '...');
                                    resolve(dataUrl);
                                };
                            }
                        };
                        stopChartInstance.update();
                    });
                } catch (error) {
                    console.error('Error generating stop chart:', error);
                    alert('Failed to generate speed vs. distance chart. Please check console logs.');
                }
            }
            // Naye analysis functions ko call karein
            const speedRangeSummary = calculateSpeedRangeSummary(normalizedData, rakeType, maxPermissibleSpeed);
            const sectionSpeedSummary = calculateSectionSpeedSummary(normalizedData, normalizedStations, fromSection, toSection);
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
                stops: stops.map((stop) => ({
                    group: stop.group,
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
                return;
            }

            setTimeout(() => {
                window.location.href = 'report.html';
            }, 1000);

            if (reportData.stopCount === 0) {
                alert('No stops found. Please check the report and console logs.');
            }
        } catch (error) {
            console.error('Error processing SPM file:', error);
            alert('Failed to process SPM file. Please check console logs.');
        }
    };

    reader.onerror = () => {
        console.error('Error reading file');
        alert('Failed to read SPM file.');
    };

    reader.readAsText(spmFile);
    } catch (error) { // <<-- AUR AAKHIR MEIN BAS YEH ERROR BLOCK ADD HUA
        console.error('Error during submission:', error);
        alert(`An error occurred: ${error.message}`);
        if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(false);
    }
});
