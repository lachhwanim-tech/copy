// --- TelproNew.js ---
// Naye Telpro format ke liye banaya gaya (Data Row 3 se, Excel Date format)

const spmConfig = {
    type: 'TelproNew',
    eventCodes: {
        zeroSpeed: 'STOP' // Hum file ke 'HALT' ko 'STOP' mein badal denge
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
    showToast('Processing SPM file, please wait...');
    if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(true);

    if (speedChartInstance) {
        speedChartInstance.destroy();
        speedChartInstance = null;
    }
    if (stopChartInstance) {
        stopChartInstance.destroy();
        stopChartInstance = null;
    }

    try { 
        showToast('Uploading data and SPM file to Google Drive. This may take a moment...');
        await uploadDataAndFileToGoogle();
        showToast('Upload complete! Now analyzing the data for the report...');

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

        if (toDateTime <= fromDateTime) {
            throw new Error('To Date and Time must be later than From Date and Time.');
        }
        if (fromSection === toSection) {
            throw new Error('From Section and To Section cannot be the same.');
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

        const lpCalls = cugData.filter(call => call['CUG MOBILE NO'] === lpCugNumber && call.startDateTime >= fromDateTime && call.startDateTime <= toDateTime);
        const alpCalls = cugData.filter(call => call['CUG MOBILE NO'] === alpCugNumber && call.startDateTime >= fromDateTime && call.startDateTime <= toDateTime);

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                // --- YAHAN SE NAYE FORMAT KA LOGIC SHURU HOTA HAI ---
                
                // Step 1: File ko Excel Date objects ke saath padhein
                const data = new Uint8Array(event.target.result);
                // `cellDates: true` Excel ke serial dates ko JS Date objects mein badal dega
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];

                // Step 2: Data ko Row 3 se padhein (index 2)
                // `header: 1` data ko array of arrays [ [A3, B3, C3...], [A4, B4, C4...] ] jaisa banata hai
                // `range: 2` ka matlab hai Row 3 (0-indexed) se shuru karein
                const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 2 });

                let normalizedData = [];
                let cumulativeDistanceMeters = 0;

                // Step 3: Naye format ke hisaab se data ko normalize karein
                jsonData.forEach((row, index) => {
                    // row[0] = Column A (Date Time - yeh pehle se hi JS Date object hoga)
                    // row[1] = Column B (Speed)
                    // row[2] = Column C (Distance per sec in meters)
                    // row[5] = Column F (Event)
                    
                    const timestamp = row[0];
                    const speed = parseFloat(row[1]) || 0;
                    const distanceIncrement = parseFloat(row[2]) || 0; // meters
                    const event = (row[5] || '').trim().toUpperCase();

                    // Check karein ki timestamp valid Date object hai ya nahi
                    if (!timestamp || !(timestamp instanceof Date) || isNaN(timestamp.getTime())) {
                        console.warn(`Skipping row ${index + 3}: Invalid date.`);
                        return; // Is row ko chhod dein
                    }

                    cumulativeDistanceMeters += distanceIncrement;
                    
                    // Event ko map karein: HALT -> STOP, baaki waise hi
                    let eventGn = event;
                    if (event === 'HALT') {
                        eventGn = spmConfig.eventCodes.zeroSpeed; // 'STOP'
                    }

                    normalizedData.push({
                        Time: timestamp,
                        Distance: cumulativeDistanceMeters, // Total meters
                        Speed: speed,
                        EventGn: eventGn // 'STOP', 'RUN', 'START', ya kuch aur
                    });
                });

                // --- NAYE FORMAT KA LOGIC YAHAN KHATAM HOTA HAI ---

                console.log('Normalized Data Sample:', normalizedData.slice(0, 5));
                console.log('Last Normalized Data:', normalizedData.slice(-5));
                console.log('Total Cumulative Distance (m):', cumulativeDistanceMeters);

                // Baaki ka poora logic Telpro.js jaisa hi hai, koi badlaav nahi
                
                let initialFilteredData = normalizedData.filter(row => row.Time >= fromDateTime && row.Time <= toDateTime);
                // Agar time range mein data na mile, toh poora data istemaal karne ki koshish karein
                if (initialFilteredData.length > 0) {
                    normalizedData = initialFilteredData;
                } else {
                    console.warn("No data found in the selected time range. Attempting to use all file data.");
                    // Yahan hum 'normalizedData' ko waise hi rehne denge
                }

                if (normalizedData.length === 0) {
                     throw new Error('No valid data found in the file, even after checking time range.');
                }

                console.log('Initial Filtered Data Length:', normalizedData.length);

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
                    throw new Error(`Selected From Station (${fromSection}) is not valid for the chosen Section (${section}).`);
                }

                const fromDistance = fromStation.distance;
                normalizedData.forEach(row => {
                    row.NormalizedDistance = row.Distance - fromDistance;
                });

                let departureIndex = normalizedData.findIndex((row, i) => {
                    if (row.Time < fromDateTime || row.Time > toDateTime || row.Speed < 1) return false;
                    let distanceMoved = 0;
                    let startDistance = row.Distance;
                    for (let j = i; j < normalizedData.length; j++) {
                        const currentSpeed = normalizedData[j].Speed;
                        if (currentSpeed === 0) return false;
                        distanceMoved += Math.abs(normalizedData[j].Distance - startDistance);
                        startDistance = normalizedData[j].Distance;
                        if (distanceMoved >= 200) return true;
                    }
                    return false;
                });

                if (departureIndex === -1) {
                    // Fallback: Agar time range mein nahi mila, toh time range ke bahar dekho
                    departureIndex = normalizedData.findIndex((row, i) => {
                        if (row.Speed < 1) return false;
                        let distanceMoved = 0;
                        let startDistance = row.Distance;
                        for (let j = i; j < normalizedData.length; j++) {
                            const currentSpeed = normalizedData[j].Speed;
                            if (currentSpeed === 0) return false;
                            distanceMoved += Math.abs(normalizedData[j].Distance - startDistance);
                            startDistance = normalizedData[j].Distance;
                            if (distanceMoved >= 200) return true;
                        }
                        return false;
                    });
                    
                    if(departureIndex === -1) {
                         throw new Error('No valid departure found in the file (Speed >= 1 km/h with 200m continuous movement without zero speed).');
                    } else {
                        console.warn("Valid departure found outside selected time range. Adjusting data start time.");
                    }
                }

                const departureTime = normalizedData[departureIndex].Time;
                console.log('Departure Time:', departureTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }));

                let filteredData = normalizedData.filter(row => {
                    const rowTime = row.Time;
                    return rowTime >= departureTime && rowTime <= toDateTime && !isNaN(rowTime.getTime());
                });

                if (filteredData.length === 0) {
                     console.warn('No data found between departure time and selected end time. Using all data after departure.');
                     filteredData = normalizedData.filter(row => row.Time >= departureTime);
                     if (filteredData.length === 0) {
                         throw new Error('No valid data found after departure.');
                     }
                }

                const initialDistance = filteredData[0].NormalizedDistance;
                normalizedData = filteredData.map(row => ({
                    ...row,
                    Distance: row.NormalizedDistance - initialDistance // Ab Distance meters mein hai, from station se relative
                }));

                console.log('Normalized Data (first 5):', normalizedData.slice(0, 5));

                const fromIndex = stationsData.findIndex(station => station.name === fromSection);
                const toIndex = stationsData.findIndex(station => station.name === toSection);
                if (fromIndex === -1 || toIndex === -1) {
                    throw new Error(`Invalid From (${fromSection}) or To (${toSection}) Station.`);
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
                        if (sectionName === 'Unknown') {
                            const atStationOrSignal = window.stationSignalData.find(signalRow => {
                                if (signalRow['SECTION'] !== section) return false;
                                const signalDistance = parseFloat(signalRow['CUMMULATIVE DISTANT(IN Meter)']) - fromDistance;
                                const rangeStart = signalDistance - 400;
                                const rangeEnd = signalDistance + 400;
                                const rowDistanceM = row.Distance;
                                return rowDistanceM >= rangeStart && rowDistanceM <= rangeEnd;
                            });
                            if (atStationOrSignal) {
                                sectionName = `${atStationOrSignal['STATION']} ${atStationOrSignal['SIGNAL NAME'] || ''}`.trim();
                            }
                        }

                        if (!overSpeedGroup || overSpeedGroup.section !== sectionName ||
                            (index > 0 && (row.Time - normalizedData[index - 1].Time) > 10000)) {
                            if (overSpeedGroup) {
                                overSpeedDetails.push({
                                    section: overSpeedGroup.section,
                                    timeRange: `${overSpeedGroup.startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}-${overSpeedGroup.endTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`,
                                    speedRange: `${overSpeedGroup.minSpeed.toFixed(2)}-${overSpeedGroup.maxSpeed.toFixed(2)}`
                                });
                            }
                            overSpeedGroup = {
                                section: sectionName,
                                startTime: row.Time,
                                endTime: row.Time,
                                minSpeed: row.Speed,
                                maxSpeed: row.Speed
                            };
                        } else {
                            overSpeedGroup.endTime = row.Time;
                            overSpeedGroup.minSpeed = Math.min(overSpeedGroup.minSpeed, row.Speed);
                            overSpeedGroup.maxSpeed = Math.max(overSpeedGroup.maxSpeed, row.Speed);
                        }
                    } else {
                        if (overSpeedGroup) {
                            overSpeedDetails.push({
                                section: overSpeedGroup.section,
                                timeRange: `${overSpeedGroup.startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}-${overSpeedGroup.endTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`,
                                speedRange: `${overSpeedGroup.minSpeed.toFixed(2)}-${overSpeedGroup.maxSpeed.toFixed(2)}`
                            });
                            overSpeedGroup = null;
                        }
                    }
                });

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
                    if (timeDiffSec <= 0 || timeDiffSec > 5) return; // Ignore bade gaps

                    const speedDiff = row.Speed - prevRow.Speed;
                    const acceleration = speedDiff / timeDiffSec; // Kmph/s

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
                    if (sectionName === 'Unknown') {
                        const atStationOrSignal = window.stationSignalData.find(signalRow => {
                            if (signalRow['SECTION'] !== section) return false;
                            const signalDistance = parseFloat(signalRow['CUMMULATIVE DISTANT(IN Meter)']) - fromDistance;
                            const rangeStart = signalDistance - 400;
                            const rangeEnd = signalDistance + 400;
                            const rowDistanceM = row.Distance;
                            return rowDistanceM >= rangeStart && rowDistanceM <= rangeEnd;
                        });
                        if (atStationOrSignal) {
                            sectionName = `${atStationOrSignal['STATION']} ${atStationOrSignal['SIGNAL NAME'] || ''}`.trim();
                        }
                    }

                    // Wheel Slip: Speed 1 second mein 4 Kmph se zyada badhe
                    if (acceleration >= 4) {
                        if (!wheelSlipGroup || wheelSlipGroup.section !== sectionName || (row.Time - prevRow.Time) > 10000) {
                            if (wheelSlipGroup) wheelSlipDetails.push({ ...wheelSlipGroup });
                            wheelSlipGroup = {
                                section: sectionName,
                                timeRange: `${prevRow.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}-${row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`,
                                speedRange: `${prevRow.Speed.toFixed(2)}-${row.Speed.toFixed(2)}`
                            };
                        } else {
                            // Update end time and speed range
                            wheelSlipGroup.timeRange = `${wheelSlipGroup.timeRange.split('-')[0]}-${row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`;
                            wheelSlipGroup.speedRange = `${wheelSlipGroup.speedRange.split('-')[0]}-${row.Speed.toFixed(2)}`;
                        }
                    } else {
                        if (wheelSlipGroup) wheelSlipDetails.push({ ...wheelSlipGroup });
                        wheelSlipGroup = null;
                    }


                    // Wheel Skid: Speed 1 second mein 5 Kmph se zyada ghate
                    if (acceleration <= -5) {
                        if (!wheelSkidGroup || wheelSkidGroup.section !== sectionName || (row.Time - prevRow.Time) > 10000) {
                            if (wheelSkidGroup) wheelSkidDetails.push({ ...wheelSkidGroup });
                            wheelSkidGroup = {
                                section: sectionName,
                                timeRange: `${prevRow.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}-${row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`,
                                speedRange: `${prevRow.Speed.toFixed(2)}-${row.Speed.toFixed(2)}`
                            };
                        } else {
                            wheelSkidGroup.timeRange = `${wheelSkidGroup.timeRange.split('-')[0]}-${row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`;
                            wheelSkidGroup.speedRange = `${wheelSkidGroup.speedRange.split('-')[0]}-${row.Speed.toFixed(2)}`;
                        }
                    } else {
                        if (wheelSkidGroup) wheelSkidDetails.push({ ...wheelSkidGroup });
                        wheelSkidGroup = null;
                    }
                });

                if (wheelSlipGroup) wheelSlipDetails.push({ ...wheelSlipGroup });
                if (wheelSkidGroup) wheelSkidDetails.push({ ...wheelSkidGroup });

                console.log('Wheel Slip Details:', wheelSlipDetails);
                console.log('Wheel Skid Details:', wheelSkidDetails);

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
                        : { // GOODS or MEMU
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
                    let distanceAtMPS = 0;

                    for (let i = 1; i < data.length; i++) {
                        const prevPoint = data[i - 1];
                        const currPoint = data[i];

                        const distanceDiff = Math.abs(currPoint.Distance - prevPoint.Distance);
                        if (distanceDiff > 0) {
                            totalDistance += distanceDiff;
                            const avgSpeed = (prevPoint.Speed + currPoint.Speed) / 2;
                            
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

                const calculateSectionSpeedSummary = (data, stations, fromStn, toStn) => {
                    const summary = [];
                    for (let i = 0; i < stations.length - 1; i++) {
                        const startStation = stations[i];
                        const endStation = stations[i + 1];
                        const sectionName = `${startStation.name}-${endStation.name}`;

                        const sectionData = data.filter(d => d.Distance >= startStation.distance && d.Distance < endStation.distance);
                        
                        if (sectionData.length > 0) {
                            const speeds = sectionData.map(d => d.Speed).filter(s => s > 0);
                            
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
                            
                            const maxSpeed = speeds.length > 0 ? Math.max(...speeds).toFixed(2) : 'N/A';
                            const avgSpeed = speeds.length > 0
                                ? (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(2)
                                : 'N/A';

                            summary.push({ section: sectionName, modeSpeed, maxSpeed, averageSpeed: avgSpeed });
                        }
                    }

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
                                // Time difference ko seconds mein calculate karein
                                const timeDiff = (i < normalizedData.length - 1 && normalizedData[i + 1].Time > rowTime) ?
                                    (normalizedData[i + 1].Time - rowTime) / 1000 :
                                    1; // Default 1 second agar aakhri point hai
                                
                                if (normalizedData[i].Speed > 1) {
                                    runDuration += timeDiff;
                                    maxSpeed = Math.max(maxSpeed, normalizedData[i].Speed);
                                } else {
                                    stopDuration += timeDiff;
                                }
                            }
                        }

                        const totalCalculated = runDuration + stopDuration;
                        if (totalCalculated > 0 && totalDuration > 0) {
                            // CUG file ke total duration ke hisaab se scale karein
                            runDuration = (runDuration / totalCalculated) * totalDuration;
                            stopDuration = (stopDuration / totalCalculated) * totalDuration;
                        } else if (totalCalculated === 0 && totalDuration > 0) {
                            // Agar data mein call nahi mila, toh poora duration stop maan lein
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
                console.log('Crew Call Data:', crewCallData);

                let stops = [];
                let stopGroup = 0;
                let potentialStops = [];
                for (let i = 0; i < normalizedData.length; i++) {
                    const row = normalizedData[i];
                    // Humara 'STOP' code ab 'HALT' se aa raha hai
                    if (row.EventGn === spmConfig.eventCodes.zeroSpeed && row.Speed === 0) {
                        potentialStops.push({
                            index: i,
                            time: row.Time,
                            timeString: row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
                            timeLabel: row.Time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
                            kilometer: row.Distance // Yeh meters mein hai
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
                        return timeDiff > 10; // 10 second ka gap
                    })();

                    if (isLastInSequence && currentGroup.length > 0) {
                        // Group ka pehla stop lein (jab stop shuru hua)
                        const firstStop = currentGroup[0];
                        const stopKey = `${firstStop.kilometer.toFixed(3)}-${firstStop.timeString}`;
                        if (!seenStops.has(stopKey)) {
                            seenStops.add(stopKey);
                            stops.push({
                                ...firstStop,
                                group: ++stopGroup
                            });
                        }
                        currentGroup = [];
                    }
                }

                // 200m se kam doori waale stops ko filter karein
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

                const processedStops = stops.map((stop, stopIndex) => {
                    let startTiming = null;
                    let startTimeObject = null;
                    let startEventFound = false;

                    const stopDataIndex = stop.index;
                    for (let i = stopDataIndex + 1; i < normalizedData.length; i++) {
                        const currentSpeed = normalizedData[i].Speed;
                        const currentTime = new Date(normalizedData[i].Time);
                        const currentEvent = normalizedData[i].EventGn;
                        
                        // Train chalu hone ka logic: Speed 0 se zyada ho, YA event 'START' ho
                        if ((currentSpeed > 0 || currentEvent === 'START') && currentTime > stop.time) {
                            startTimeObject = currentTime;
                            startTiming = currentTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                            startEventFound = true;
                            break;
                        }
                    }
                    
                    const duration = startTimeObject ? (startTimeObject.getTime() - stop.time.getTime()) / 1000 : 0;
                    const isLastStopOfJourney = (stopIndex === stops.length - 1) && !startEventFound;
                    
                    return { ...stop, startTiming: startTiming || 'N/A', duration, isLastStopOfJourney };
                });

                stops = processedStops.filter(stop => stop.duration >= 10 || stop.isLastStopOfJourney);

                stops.forEach((stop, index) => {
                    stop.group = index + 1;
                });

                console.log('Final count of stops (duration >= 10s or last stop):', stops.length);

                const finalStops = stops.map(stop => {
                    const stopDistance = stop.kilometer; // meters
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

                    const distancesBefore = [1000, 800, 500, 100, 50]; // meters
                    const speedsBefore = distancesBefore.map(targetDistance => {
                        let closestRow = null;
                        let minDistanceDiff = Infinity;
                        // Stop ke index se peeche ki taraf dhoondein
                        for (let i = stop.index; i >= 0; i--) {
                            const row = normalizedData[i];
                            const distanceDiff = stop.kilometer - row.Distance; // meters
                            
                            // Check karein ki row stop se pehle hai
                            if (distanceDiff >= 0) {
                                // Check karein ki yeh target distance ke sabse kareeb hai
                                const diffFromTarget = Math.abs(distanceDiff - targetDistance);
                                if (diffFromTarget < minDistanceDiff) {
                                    minDistanceDiff = diffFromTarget;
                                    closestRow = row;
                                }
                            }
                            
                            // Agar target se bahut door nikal gaye toh loop tod dein
                            if (distanceDiff > targetDistance + 2000) break;
                        }
                        return closestRow ? closestRow.Speed.toFixed(2) : 'N/A';
                    });
                    
                    const parsedSpeeds = speedsBefore.map(speed => parseFloat(speed) || Infinity);
                    const speed800m = parsedSpeeds[1];
                    const speed500m = parsedSpeeds[2];
                    const speed100m = parsedSpeeds[3];
                    const speed50m  = parsedSpeeds[4];

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

                stops = finalStops;
                console.log('Enhanced Stops:', stops);

                const trackSpeedReduction = (data, startIdx, maxDurationMs) => {
                    const startSpeed = data[startIdx].Speed;
                    const startTime = data[startIdx].Time.getTime();
                    let lowestSpeed = startSpeed;
                    let lowestSpeedIdx = startIdx;
                    let speedHitZero = false;

                    let increaseStartTime = null;
                    let speedAtIncreaseStart = 0;

                    for (let i = startIdx + 1; i < data.length; i++) {
                        const currentSpeed = data[i].Speed;
                        const currentTime = data[i].Time.getTime();

                        if (currentTime - startTime > maxDurationMs) break;
                        if (currentSpeed === 0) {
                            speedHitZero = true;
                            break;
                        }

                        if (currentSpeed <= lowestSpeed) {
                            lowestSpeed = currentSpeed;
                            lowestSpeedIdx = i;
                            increaseStartTime = null;
                        } else {
                            if (increaseStartTime === null) {
                                increaseStartTime = currentTime;
                                speedAtIncreaseStart = lowestSpeed;
                            }
                            const increaseDuration = currentTime - increaseStartTime;
                            const increaseMagnitude = currentSpeed - speedAtIncreaseStart;
                            if (increaseMagnitude > 2 || increaseDuration > 2000) {
                                break;
                            }
                        }
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
                            bftMissed = true;
                        }
                    }

                    if (!bptDetails && !bptMissed) {
                        if (speed >= brakeTestsConfig.bpt.minSpeed && speed <= brakeTestsConfig.bpt.maxSpeed) {
                            const result = trackSpeedReduction(normalizedData, i, brakeTestsConfig.bpt.maxDuration);
                            if (result && result.timeDiff > 1) {
                                const speedReduction = speed - result.speed;
                                const requiredReduction = speed * 0.40;
                                
                                if (speedReduction >= requiredReduction) {
                                    bptDetails = {
                                        time: row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }),
                                        startSpeed: speed.toFixed(2),
                                        endSpeed: result.speed.toFixed(2),
                                        reduction: speedReduction.toFixed(2),
                                        timeTaken: result.timeDiff.toFixed(0),
                                        endTime: normalizedData[result.index].Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })
                                    };
                                }
                            }
                        } else if (speed > brakeTestsConfig.bpt.maxSpeed) {
                            bptMissed = true;
                        }
                    }

                    if ((bftDetails || bftMissed) && (bptDetails || bptMissed)) {
                        break;
                    }
                }

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

                let speedChartImage = null;
                if (labels.length === 0 || speeds.length === 0) {
                    console.warn('No valid data for Speed vs Time chart.');
                } else {
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
                                scales: { x: { title: { display: true, text: 'Time' } }, y: { title: { display: true, text: 'Speed (kmph)' }, beginAtZero: true } },
                                plugins: { legend: { display: false } }
                            }
                        });

                        speedChartImage = await new Promise((resolve) => {
                            speedChartInstance.options.animation = {
                                onComplete: () => {
                                    const tempCanvas = document.createElement('canvas');
                                    tempCanvas.width = 400; tempCanvas.height = 600;
                                    const tempCtx = tempCanvas.getContext('2d');
                                    tempCtx.translate(400, 0); tempCtx.rotate(Math.PI / 2);
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
                    }
                }

                let stopChartImage = null;
                const distanceLabels = [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100, 50, 0];
                const selectedStops = stops.length > 10 ? stops.slice(0, 10) : stops;
                console.log('Total Stops:', stops.length, 'Selected Stops:', selectedStops.length);

                let stopDatasets = selectedStops.map((stop, index) => {
                    const speeds = distanceLabels.map(targetDistance => {
                        let closestRow = null;
                        let minDistanceDiff = Infinity;
                        for (let i = stop.index; i >= 0; i--) {
                            const row = normalizedData[i];
                            const distanceDiff = stop.kilometer - row.Distance;
                            if(distanceDiff >= 0) {
                                const absDiff = Math.abs(distanceDiff - targetDistance);
                                if (absDiff < minDistanceDiff) {
                                    minDistanceDiff = absDiff;
                                    closestRow = row;
                                }
                            }
                        }
                        return closestRow ? closestRow.Speed : 0;
                    });
                    const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFA500', '#800080', '#00FFFF', '#FF00FF', '#FFFF00', '#008080', '#FFC0CB'];
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

                if (stopDatasets.length > 0) {
                    try {
                        const stopCtx = document.getElementById('stopChart')?.getContext('2d');
                        if (!stopCtx) throw new Error('Stop Chart canvas not found');
                        document.getElementById('stopChart').width = 600;
                        document.getElementById('stopChart').height = 400;
                        stopChartInstance = new Chart(stopCtx, {
                            type: 'line',
                            data: { labels: distanceLabels, datasets: stopDatasets },
                            options: {
                                responsive: false,
                                scales: { x: { title: { display: true, text: 'Distance Before Stop (m)' } }, y: { title: { display: true, text: 'Speed (kmph)' }, beginAtZero: true } },
                                plugins: { legend: { display: true, position: 'top' }, title: { display: true, text: 'Speed vs. Distance Before Stop' } }
                            }
                        });

                        stopChartImage = await new Promise((resolve) => {
                            stopChartInstance.options.animation = {
                                onComplete: () => {
                                    const tempCanvas = document.createElement('canvas');
                                    tempCanvas.width = 400; tempCanvas.height = 600;
                                    const tempCtx = tempCanvas.getContext('2d');
                                    tempCtx.translate(400, 0); tempCtx.rotate(Math.PI / 2);
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
                    }
                } else {
                    console.warn('No stops data for Speed vs Distance chart.');
                }

                const stationStops = normalizedStations.map((station, stationIndex) => {
                    const totalDistanceKm = normalizedData.length > 0 ? (normalizedData[normalizedData.length - 1].Distance / 1000) : 0;
                    let tolerance = (rakeType === 'COACHING' && totalDistanceKm > 200) ? 800 : 400;

                    const stopRangeStart = station.distance - tolerance;
                    const stopRangeEnd = station.distance + tolerance;

                    const potentialStops = stops.filter(stop => stop.kilometer >= stopRangeStart && stop.kilometer <= stopRangeEnd);
                    let stationStop = potentialStops.length > 0 ? potentialStops[potentialStops.length - 1] : null;

                    let arrivalTime = 'N/A';
                    let departureTime = 'N/A';

                    if (stationStop) {
                        arrivalTime = stationStop.timeString;
                        departureTime = stationStop.startTiming;
                    } else if (stationIndex !== normalizedStations.length - 1) {
                        let closestPoint = null;
                        let minDistanceDiff = Infinity;
                        for (const row of normalizedData) {
                            const distDiff = Math.abs(row.Distance - station.distance);
                            if (distDiff <= 1000 && distDiff < minDistanceDiff && row.Time >= fromDateTime && row.Time <= toDateTime) {
                                minDistanceDiff = distDiff;
                                closestPoint = row;
                            }
                        }
                        if (closestPoint) {
                            departureTime = closestPoint.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                        }
                    }

                    if (stationIndex === 0 && station.name === fromSection) {
                        departureTime = filteredData[0].Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                        arrivalTime = 'N/A';
                    }

                    if (stationIndex === normalizedStations.length - 1 && station.name === toSection) {
                        if (stationStop) {
                            arrivalTime = stationStop.timeString;
                        } else {
                            let lastValidPoint = null;
                            let minTimeDiff = Infinity;
                            for (const row of normalizedData) {
                                const timeDiff = Math.abs(toDateTime - row.Time);
                                const distDiff = Math.abs(row.Distance - station.distance);
                                if (distDiff <= 2000 && row.Time <= toDateTime && timeDiff < minTimeDiff) {
                                    minTimeDiff = timeDiff;
                                    lastValidPoint = row;
                                }
                            }
                            if (lastValidPoint) {
                                arrivalTime = lastValidPoint.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                            } else if (normalizedData.length > 0) {
                                // Fallback: Aakhri point ko arrival maan lo
                                arrivalTime = normalizedData[normalizedData.length-1].Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                            }
                        }
                        departureTime = 'N/A';
                    }

                    return { station: station.name, arrival: arrivalTime, departure: departureTime };
                });

                console.log('Station Stops:', stationStops);
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
                    speedRangeSummary,
                    sectionSpeedSummary,
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
                    stopChartConfig: { labels: reportData.stopChartConfig.labels.length, datasets: reportData.stopChartConfig.datasets.length },
                    speedChartImage: reportData.speedChartImage ? 'Present' : 'Missing',
                    stopChartImage: reportData.stopChartImage ? 'Present' : 'Missing'
                });

                localStorage.setItem('spmReportData', JSON.stringify(reportData));
                console.log('reportData saved to localStorage');
                
                showToast('Analysis complete! Opening report...');
                setTimeout(() => {
                    window.location.href = 'report.html';
                }, 1000); // Thoda delay taaki toast dikhe

            } catch (error) {
                console.error('Error processing SPM file:', error);
                alert('Failed to process SPM file: ' + error.message);
                if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(false);
            }
        };

        reader.onerror = () => {
            console.error('Error reading file');
            alert('Failed to read SPM file.');
            if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(false);
        };

        reader.readAsArrayBuffer(spmFile);

    } catch (error) {
        console.error('Error during submission:', error);
        alert(`An error occurred: ${error.message}`);
        if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(false);
    }
});
