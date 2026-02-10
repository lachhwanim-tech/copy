// RTIS.js - Full updated with Medha BFT/BPT + improved crew-call analysis + CSV support + speed rounding
// Replace your existing RTIS.js with this file.

const spmConfig = {
    type: 'RTIS',
    // Legacy defaults (used if auto-detect fails)
    columnNames: {
        time: 'Gps Time',
        distance: 'distFromPrevLatLng',
        speed: 'Speed',
        event: 'Event'
    },
    eventCodes: {
        zeroSpeed: 'STOP'
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

// Globals
let speedChartInstance = null;
let stopChartInstance = null;

// ---------- Utilities ----------
function findHeaderLike(headers, patterns) {
    if (!headers || !headers.length) return null;
    const lowerHeaders = headers.map(h => (h || '').toString().trim().toLowerCase());
    for (const pat of patterns) {
        const lp = pat.toLowerCase();
        const idx = lowerHeaders.findIndex(h => h.includes(lp));
        if (idx !== -1) return headers[idx];
    }
    return null;
}

function excelSerialToJSDate(serial) {
    const epoch = Date.UTC(1899, 11, 30);
    const milliseconds = Math.round(serial * 24 * 3600 * 1000);
    const utcDate = new Date(epoch + milliseconds);
    const localDate = new Date(utcDate.getTime() + (utcDate.getTimezoneOffset() * 60 * 1000));
    return localDate;
}

function parseExcelOrStringDate(value) {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'number') return excelSerialToJSDate(value);
    const str = value.toString().trim();
    if (!str) return null;
    if (/^\d+(\.\d+)?$/.test(str)) {
        return excelSerialToJSDate(Number(str));
    }
    const d1 = new Date(str);
    if (!isNaN(d1.getTime())) return d1;
    const regex = /^(?:(\d{2})[-\/](\d{2})[-\/](\d{4})|(\d{4})[-\/](\d{2})[-\/](\d{2}))\s+(\d{2}):(\d{2})(?::(\d{2}))?$/;
    const m = str.match(regex);
    if (m) {
        if (m[1]) {
            const iso = `${m[3]}-${m[2]}-${m[1]}T${m[7]}:${m[8] || '00'}:${m[9] || '00'}`;
            const d2 = new Date(iso);
            if (!isNaN(d2.getTime())) return d2;
        } else {
            const iso = `${m[4]}-${m[5]}-${m[6]}T${m[7]}:${m[8] || '00'}:${m[9] || '00'}`;
            const d2 = new Date(iso);
            if (!isNaN(d2.getTime())) return d2;
        }
    }
    const d3 = new Date(str.replace(' ', 'T'));
    return (!isNaN(d3.getTime())) ? d3 : null;
}

function findNumericColumn(headers, rows) {
    if (!headers || !rows || rows.length === 0) return null;
    const scores = headers.map(h => 0);
    headers.forEach((h, i) => {
        let numericCount = 0, total = 0;
        for (let r = 0; r < Math.min(rows.length, 50); r++) {
            const val = rows[r][h];
            if (val === null || val === undefined || val === '') continue;
            total++;
            if (!isNaN(parseFloat(val))) numericCount++;
        }
        scores[i] = total > 0 ? (numericCount / total) : 0;
    });
    const maxScore = Math.max(...scores);
    if (maxScore >= 0.6) return headers[scores.indexOf(maxScore)];
    return null;
}

// ---------- Robust speed lookup helpers ----------
/**
 * Find nearest previous row index such that row is before stopIndex.
 * Returns object {idx, row, distDiff} where distDiff = Math.abs((stopKm - row.Distance) - targetMeters)
 */
function findNearestPreviousRow(stopIndex, stopKm, data, targetMeters) {
    let best = null;
    let bestDiff = Infinity;
    for (let i = stopIndex - 1; i >= 0; i--) {
        const diff = Math.abs((stopKm - data[i].Distance) - targetMeters);
        if (diff < bestDiff) {
            bestDiff = diff;
            best = { idx: i, row: data[i], distDiff: diff };
        }
    }
    return best;
}

/**
 * Primary helper: returns speed (number) at approximately `targetMeters` before the stop.
 * Strategy:
 *  1) Try strict previous row where (stopKm - row.Distance) >= targetMeters (closest earlier row meeting threshold)
 *  2) If none, pick nearest previous row (closest distance difference)
 *  3) (Optional) Linear interpolation block is commented — enable if you prefer interpolated speeds.
 */
function getSpeedAtDistanceBeforeStop(stopIndex, stopKm, data, targetMeters) {
    // 1) Strict search - earliest row from back meeting >= targetMeters
    for (let i = stopIndex - 1; i >= 0; i--) {
        const distBefore = stopKm - data[i].Distance;
        if (distBefore >= targetMeters) {
            return Number(data[i].Speed) || 0;
        }
    }

    // 2) nearest previous row fallback
    const nearest = findNearestPreviousRow(stopIndex, stopKm, data, targetMeters);
    if (nearest && nearest.row) {
        return Number(nearest.row.Speed) || 0;
    }

    // 3) FURTHER FALLBACK: If nothing found, return 0 (should be rare)
    return 0;

    /* OPTIONAL: Linear interpolation between surrounding rows (enable if you prefer)
    // find two rows around the targetDistance (one just before and one just after target)
    let before = null, after = null;
    for (let i = stopIndex - 1; i >= 0; i--) {
        const distBefore = stopKm - data[i].Distance;
        if (distBefore >= targetMeters) { before = data[i]; break; }
    }
    // find 'after' (closer to stop, distance < targetMeters)
    for (let i = stopIndex - 1; i >= 0; i--) {
        const distBefore = stopKm - data[i].Distance;
        if (distBefore < targetMeters) { after = data[i]; break; }
    }
    if (before && after) {
        const d1 = stopKm - before.Distance; // >= targetMeters
        const s1 = Number(before.Speed);
        const d2 = stopKm - after.Distance; // < targetMeters
        const s2 = Number(after.Speed);
        // linear interpolate speed at targetMeters
        const frac = (targetMeters - d2) / (d1 - d2);
        return Number((s2 + frac * (s1 - s2)).toFixed(1));
    }
    // fallback nearest
    return nearest ? Number(nearest.row.Speed) || 0 : 0;
    */
}

// ---------- CUG parser ----------
const parseAndProcessCugData = (file) => {
    return new Promise((resolve, reject) => {
        if (!file) return reject(new Error('CUG file is missing.'));
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            transform: (value) => (typeof value === 'string' ? value.trim() : value),
            complete: (result) => {
                if (result.errors && result.errors.length) return reject(new Error('Failed to parse CUG.csv.'));
                const processedData = result.data.map(call => {
                    const startDateTimeStr = (call['Start Date & Time'] || '').toString().trim();
                    const endDateTimeStr = (call['End Date & Time'] || '').toString().trim();
                    const dateTimeRegex = /^(?:(\d{2})[-\/](\d{2})[-\/](\d{4})|(\d{4})[-\/](\d{2})[-\/](\d{2}))\s(\d{2}):(\d{2})(?::(\d{2}))?$/;
                    const startMatch = startDateTimeStr.match(dateTimeRegex);
                    const endMatch = endDateTimeStr.match(dateTimeRegex);
                    if (startMatch && endMatch) {
                        let startDateTime, endDateTime;
                        const startSeconds = startMatch[7] || '00';
                        const endSeconds = endMatch[7] || '00';
                        if (startMatch[1]) {
                            startDateTime = new Date(`${startMatch[3]}-${startMatch[2]}-${startMatch[1]}T${startMatch[5]}:${startMatch[6]}:${startSeconds}`);
                            endDateTime = new Date(`${endMatch[3]}-${endMatch[2]}-${endMatch[1]}T${endMatch[5]}:${endMatch[6]}:${endSeconds}`);
                        } else {
                            startDateTime = new Date(`${startMatch[4]}-${startMatch[5]}-${startMatch[6]}T${startMatch[5]}:${startMatch[6]}:${startSeconds}`);
                            endDateTime = new Date(`${endMatch[4]}-${endMatch[5]}-${endMatch[6]}T${endMatch[5]}:${endMatch[6]}:${endSeconds}`);
                        }
                        return { ...call, startDateTime, endDateTime, duration: parseInt(call['Duration in Sec']) || 0, 'CUG MOBILE NO': (call['CUG MOBILE NO'] || '').toString().trim() };
                    }
                    return null;
                }).filter(Boolean);
                resolve(processedData);
            },
            error: (error) => reject(error)
        });
    });
};

// ---------- Medha-style trackSpeedReduction (improved) ----------
function trackSpeedReductionMedha(data, startIdx, maxDurationMs) {
    const start = data[startIdx];
    if (!start) return null;
    const startSpeed = start.Speed;
    const startTime = start.Time.getTime();
    let lowestSpeed = startSpeed;
    let lowestIdx = startIdx;
    let speedHitZero = false;

    let increaseStartTime = null;
    let speedAtIncreaseStart = 0;

    for (let i = startIdx + 1; i < data.length; i++) {
        const curr = data[i];
        const currSpeed = curr.Speed;
        const currTime = curr.Time.getTime();

        if (currTime - startTime > maxDurationMs) break;
        if (currSpeed === 0) {
            speedHitZero = true;
            break;
        }

        if (currSpeed <= lowestSpeed) {
            lowestSpeed = currSpeed;
            lowestIdx = i;
            increaseStartTime = null;
        } else {
            if (increaseStartTime === null) {
                increaseStartTime = currTime;
                speedAtIncreaseStart = lowestSpeed;
            }
            const increaseDuration = currTime - increaseStartTime;
            const increaseMagnitude = currSpeed - speedAtIncreaseStart;
            if (increaseMagnitude > 2 || increaseDuration > 2000) {
                break;
            }
        }
    }

    if (speedHitZero || lowestIdx === startIdx) return null;

    const endTime = data[lowestIdx].Time.getTime();
    return { index: lowestIdx, speed: lowestSpeed, timeDiff: (endTime - startTime) / 1000 };
}

// ---------- Main form submit (RTIS) ----------
document.getElementById('spmForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showToast('Processing RTIS file, please wait...');
    if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(true);

    try {
        if (speedChartInstance) speedChartInstance.destroy();
        if (stopChartInstance) stopChartInstance.destroy();

        // Upload step (kept from your earlier code)
        showToast('Uploading data and SPM file to Google Drive. This may take a moment...');
        await uploadDataAndFileToGoogle();
        showToast('Upload complete! Now analyzing the data for the report...');

        // Collect form fields
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

        if (toDateTime <= fromDateTime) throw new Error('To Date and Time must be later than From Date and Time.');
        if (fromSection === toSection) throw new Error('From Section and To Section cannot be the same.');

        let cugData = cugFile ? await parseAndProcessCugData(cugFile).catch(err => { console.error(err); return []; }) : [];
        const lpCalls = cugData.filter(call => call['CUG MOBILE NO'] === lpCugNumber && call.startDateTime >= fromDateTime && call.startDateTime <= toDateTime);
        const alpCalls = cugData.filter(call => call['CUG MOBILE NO'] === alpCugNumber && call.startDateTime >= fromDateTime && call.startDateTime <= toDateTime);

        if (!spmFile) throw new Error('Please select an SPM file (XLSX or CSV).');

        // Determine extension
        const fileExt = (spmFile.name.split('.').pop() || '').toLowerCase();

        // Read file (CSV -> text, XLSX -> arraybuffer)
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                let jsonDataRaw = [];
                if (fileExt === 'csv') {
                    // CSV parsing via PapaParse
                    const csvText = event.target.result;
                    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true, dynamicTyping: false, transform: v => (typeof v === 'string' ? v.trim() : v) });
                    if (parsed.errors && parsed.errors.length) {
                        console.warn('CSV parse errors:', parsed.errors);
                        // allow best-effort: use parsed.data if available
                    }
                    jsonDataRaw = parsed.data || [];
                } else {
                    // XLSX
                    const data = new Uint8Array(event.target.result);
                    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    jsonDataRaw = XLSX.utils.sheet_to_json(worksheet, { defval: null });
                }

                if (!jsonDataRaw || jsonDataRaw.length === 0) throw new Error("The selected SPM file is empty or invalid.");

                const headers = Object.keys(jsonDataRaw[0]);

                // Resolve keys (auto-detect)
                let timeKey = spmConfig.columnNames.time;
                let speedKey = spmConfig.columnNames.speed;
                let distanceKey = spmConfig.columnNames.distance;

                const trainBiasNew = (trainNumber && trainNumber.toString().trim() === '37178');
                const trainBiasOld = (trainNumber && trainNumber.toString().trim() === '41143');

                const hasDeviceId = headers.find(h => (h || '').toString().toLowerCase().includes('device'));
                const hasLoggingTime = headers.find(h => (h || '').toString().toLowerCase().includes('logging') || (h || '').toString().toLowerCase().includes('logging time') || (h || '').toString().toLowerCase().includes('loggingtime'));
                const hasLatitude = headers.find(h => (h || '').toString().toLowerCase().includes('latitude'));
                const hasLongitude = headers.find(h => (h || '').toString().toLowerCase().includes('longitude'));
                const hasDistFromPrev = headers.find(h => (h || '').toString().toLowerCase().includes('distfromprev') || (h || '').toString().toLowerCase().includes('distfromprevlatlng'));
                const hasDistFromSpeed = headers.find(h => (h || '').toString().toLowerCase().includes('distfromspeed'));

                let likelyNewFormat = false;
                if (trainBiasNew) likelyNewFormat = true;
                else if (trainBiasOld) likelyNewFormat = false;
                else {
                    if (hasDeviceId && (hasLoggingTime || hasLatitude || hasLongitude)) likelyNewFormat = true;
                }

                if (likelyNewFormat) {
                    timeKey = hasLoggingTime || findHeaderLike(headers, ['logging time', 'loggingtime', 'log time', 'timestamp']);
                    speedKey = findHeaderLike(headers, ['speed', 'spd']) || speedKey;
                    distanceKey = hasDistFromPrev || findHeaderLike(headers, ['distfromprevlatlng', 'distfromprev', 'dist from prev']);
                    if (!distanceKey) {
                        const numericCandidate = findNumericColumn(headers, jsonDataRaw);
                        if (numericCandidate && numericCandidate !== speedKey && numericCandidate !== timeKey) distanceKey = numericCandidate;
                    }
                } else {
                    timeKey = findHeaderLike(headers, ['gps time', 'gps_time', 'time', 'timestamp', 'date time']) || timeKey;
                    speedKey = findHeaderLike(headers, ['speed', 'spd']) || speedKey;
                    distanceKey = findHeaderLike(headers, ['distfromprevlatlng', 'distfromprev', 'distance', 'dist from prev']) || distanceKey;
                }

                if (!speedKey || !headers.includes(speedKey)) {
                    const possibleSpeed = findHeaderLike(headers, ['speed', 'spd', 'spped']);
                    if (possibleSpeed) speedKey = possibleSpeed;
                    else {
                        let candidate = null;
                        for (const h of headers) {
                            let validSpeedCount = 0, total = 0;
                            for (let i = 0; i < Math.min(80, jsonDataRaw.length); i++) {
                                const v = jsonDataRaw[i][h];
                                if (v === null || v === undefined || v === '') continue;
                                total++;
                                const n = parseFloat(String(v).replace(',', '.'));
                                if (!isNaN(n) && n >= 0 && n <= 300) validSpeedCount++;
                            }
                            if (total > 0 && (validSpeedCount / total) > 0.6) { candidate = h; break; }
                        }
                        if (candidate) speedKey = candidate;
                    }
                }

                if (!timeKey || !headers.includes(timeKey)) {
                    const possibleTime = findHeaderLike(headers, ['logging time', 'gps time', 'time', 'timestamp', 'date']);
                    if (possibleTime) timeKey = possibleTime;
                    else timeKey = headers[0];
                }

                if (!distanceKey || !headers.includes(distanceKey)) {
                    distanceKey = findHeaderLike(headers, ['distfromprev', 'distfromprevlatlng', 'distance', 'dist']) || hasDistFromSpeed || findNumericColumn(headers, jsonDataRaw);
                }

                console.log('Resolved keys:', { timeKey, speedKey, distanceKey, likelyNewFormat, trainNumber });

                let cumulativeDistanceMeters = 0;
                const parsedData = jsonDataRaw.map((row, idx) => {
                    // distance increment (some CSV/XLSX files may have cumulative distances or increments; this code assumes "distFromPrev" increments)
                    const incrRaw = distanceKey ? row[distanceKey] : null;
                    const distanceIncrement = parseFloat((incrRaw === null || incrRaw === undefined) ? 0 : String(incrRaw).replace(',', '.')) || 0;
                    cumulativeDistanceMeters += distanceIncrement;

                    // Time parsing (robust)
                    const timeValue = row[timeKey];
                    let parsedTime = parseExcelOrStringDate(timeValue);
                    if ((!parsedTime || isNaN(parsedTime.getTime())) && typeof timeValue === 'string' && /^\d+(\.\d+)?$/.test(timeValue.trim())) {
                        parsedTime = excelSerialToJSDate(Number(timeValue.trim()));
                    }
                    if (!parsedTime || isNaN(parsedTime.getTime())) {
                        // try fallback: look for any column which looks like a date
                        const dateCol = Object.keys(row).find(h => h.toLowerCase().includes('time') || h.toLowerCase().includes('date'));
                        if (dateCol && row[dateCol]) parsedTime = parseExcelOrStringDate(row[dateCol]);
                    }
                    if (!parsedTime || isNaN(parsedTime.getTime())) {
                        console.warn(`Row ${idx} invalid time:`, timeValue);
                        return null;
                    }

                    // Speed parsing with rounding logic
                    let speedVal = (speedKey ? row[speedKey] : null);
                    if (speedVal === null || speedVal === undefined || speedVal === '') {
                        // try find another numeric column as fallback
                        const alt = Object.keys(row).find(h => {
                            const v = row[h];
                            if (v === null || v === undefined || v === '') return false;
                            const n = parseFloat(String(v).replace(',', '.'));
                            return !isNaN(n) && n >= 0 && n <= 300;
                        });
                        speedVal = alt ? row[alt] : 0;
                    }

                    let speedNum = parseFloat(String(speedVal).replace(',', '.'));
                    if (isNaN(speedNum)) speedNum = 0;

                    // --- NEW: treat very small floats as zero and round to 0 decimals ---
                    if (Math.abs(speedNum) < 0.5) {
                        speedNum = 0;
                    } else {
                        speedNum = Math.round(speedNum);
                    }

                    return {
                        Time: parsedTime,
                        Distance: cumulativeDistanceMeters / 1000, // km
                        Speed: speedNum,
                        EventGn: (speedNum === 0) ? spmConfig.eventCodes.zeroSpeed : ''
                    };
                }).filter(Boolean);

                if (parsedData.length === 0) throw new Error('No valid data with recognizable dates found in the file.');

                // station map
                const stationMap = new Map();
                window.stationSignalData.filter(r => r['SECTION'] === section).forEach(r => {
                    if (!stationMap.has(r['STATION'])) stationMap.set(r['STATION'], { name: r['STATION'], distance: parseFloat(r['CUMMULATIVE DISTANT(IN Meter)']) || 0 });
                });
                const stationsData = Array.from(stationMap.values());
                const fromStation = stationsData.find(s => s.name === fromSection);
                if (!fromStation) throw new Error(`From Station (${fromSection}) not valid for Section (${section}).`);

                const fromDistance = fromStation.distance;
                parsedData.forEach(row => row.NormalizedDistance = (row.Distance * 1000) - fromDistance);

                // Departure detection (first valid movement)
                let departureIndex = parsedData.findIndex((row, i, arr) => {
                    if (row.Time < fromDateTime || row.Time > toDateTime || row.Speed < 1) return false;
                    let distMoved = 0, startDist = row.Distance;
                    for (let j = i; j < arr.length; j++) {
                        if (arr[j].Speed === 0) return false;
                        distMoved += Math.abs(arr[j].Distance - startDist);
                        startDist = arr[j].Distance;
                        if (distMoved >= 0.2) return true;
                    }
                    return false;
                });

                if (departureIndex === -1) throw new Error('No valid departure found.');

                let filteredData = parsedData.filter(row => row.Time >= parsedData[departureIndex].Time && row.Time <= toDateTime);
                if (filteredData.length === 0) throw new Error('No data found after departure.');

                const initialDistance = filteredData[0].NormalizedDistance;
                let normalizedData = filteredData.map(row => ({ ...row, Distance: row.NormalizedDistance - initialDistance }));

                const fromIdx = stationsData.findIndex(s => s.name === fromSection);
                const toIdx = stationsData.findIndex(s => s.name === toSection);
                const routeStations = stationsData.slice(Math.min(fromIdx, toIdx), Math.max(fromIdx, toIdx) + 1);
                let normalizedStations = routeStations.map(s => ({ name: s.name, distance: Math.abs(s.distance - fromDistance) }));

                // --------- ANALYSIS: OverSpeed, WheelSlip/Skid, Stops, Brake Tests (Medha) ---------
                const overSpeedDetails = getOverSpeedDetails(normalizedData, maxPermissibleSpeed, normalizedStations);
                const { wheelSlipDetails, wheelSkidDetails } = getWheelSlipAndSkidDetails(normalizedData, normalizedStations);

                let stops = getStopDetails(normalizedData, spmConfig.eventCodes.zeroSpeed, section, fromDistance, normalizedStations, rakeType);

                // BFT/BPT using Medha improved logic (first instance)
                const brakeConf = spmConfig.brakeTests[rakeType] || spmConfig.brakeTests.GOODS;
                let bftDetails = null, bptDetails = null, bftMissed = false, bptMissed = false;

                for (let i = 0; i < normalizedData.length; i++) {
                    const row = normalizedData[i];
                    const speed = row.Speed;

                    // BFT
                    if (!bftDetails && !bftMissed) {
                        if (speed >= brakeConf.bft.minSpeed && speed <= brakeConf.bft.maxSpeed) {
                            const res = trackSpeedReductionMedha(normalizedData, i, brakeConf.bft.maxDuration);
                            if (res && res.timeDiff > 1) {
                                const reduction = speed - res.speed;
                                if (reduction >= 5) {
                                    bftDetails = {
                                        time: row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }),
                                        startSpeed: speed.toFixed(0),
                                        endSpeed: res.speed.toFixed(0),
                                        reduction: reduction.toFixed(0),
                                        timeTaken: res.timeDiff.toFixed(0),
                                        endTime: normalizedData[res.index].Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })
                                    };
                                }
                            }
                        } else if (speed > brakeConf.bft.maxSpeed) {
                            bftMissed = true;
                        }
                    }

                    // BPT
                    if (!bptDetails && !bptMissed) {
                        if (speed >= brakeConf.bpt.minSpeed && speed <= brakeConf.bpt.maxSpeed) {
                            const res = trackSpeedReductionMedha(normalizedData, i, brakeConf.bpt.maxDuration);
                            if (res && res.timeDiff > 1) {
                                const reduction = speed - res.speed;
                                const requiredReduction = Math.max(5, Math.round(speed * 0.40)); // Medha: >=40% OR >=5 kmph
                                if (reduction >= requiredReduction) {
                                    bptDetails = {
                                        time: row.Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }),
                                        startSpeed: speed.toFixed(0),
                                        endSpeed: res.speed.toFixed(0),
                                        reduction: reduction.toFixed(0),
                                        timeTaken: res.timeDiff.toFixed(0),
                                        endTime: normalizedData[res.index].Time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })
                                    };
                                }
                            }
                        } else if (speed > brakeConf.bpt.maxSpeed) {
                            bptMissed = true;
                        }
                    }

                    if ((bftDetails || bftMissed) && (bptDetails || bptMissed)) break;
                }

                // Crew call analysis (Medha style)
                const analyzeCallsMedha = (calls, designation) => {
                    if (!calls || calls.length === 0) return [];
                    return calls.map((call, idx) => {
                        const callStart = call.startDateTime;
                        const callEnd = call.endDateTime;
                        const totalDuration = call.duration || ((callEnd - callStart) / 1000);
                        let runDuration = 0, stopDuration = 0, maxSpeed = 0;
                        for (let i = 0; i < normalizedData.length; i++) {
                            const rowTime = normalizedData[i].Time;
                            if (rowTime >= callStart && rowTime <= callEnd) {
                                const timeDiff = i < normalizedData.length - 1 ? (normalizedData[i + 1].Time - rowTime) / 1000 : 1;
                                if (normalizedData[i].Speed > 1) {
                                    runDuration += timeDiff;
                                    maxSpeed = Math.max(maxSpeed, normalizedData[i].Speed);
                                } else {
                                    stopDuration += timeDiff;
                                }
                            }
                        }
                        const totalCalc = runDuration + stopDuration;
                        if (totalCalc > 0) {
                            // Proportionally scale to reported call duration
                            const scale = totalDuration / totalCalc;
                            runDuration = Math.round(runDuration * scale);
                            stopDuration = Math.round(stopDuration * scale);
                        } else {
                            stopDuration = Math.round(totalDuration);
                            runDuration = 0;
                        }
                        return {
                            designation: `${designation} (Call ${idx + 1})`,
                            totalDuration: Math.round(totalDuration),
                            runDuration: runDuration,
                            stopDuration: stopDuration,
                            maxSpeed: maxSpeed > 0 ? Number(maxSpeed).toFixed(0) : 'N/A',
                            toNumbers: call['To Mobile Number'] || 'N/A'
                        };
                    });
                };

                const crewCallData = [...analyzeCallsMedha(lpCalls, lpDesg || 'LP'), ...analyzeCallsMedha(alpCalls, alpDesg || 'ALP')];

                // Station arrival/departure
                const stationStops = getStationArrivalDeparture(normalizedStations, stops, filteredData, normalizedData, fromSection, toSection);

                // Speed summaries (functions defined below same as earlier)
                const speedRangeSummary = calculateSpeedRangeSummary(normalizedData, rakeType, maxPermissibleSpeed);
                const sectionSpeedSummary = calculateSectionSpeedSummary(normalizedData, normalizedStations, fromSection, toSection);

                // Charts & images (same pattern as before)
                const maxPoints = 500;
                const sampledData = normalizedData.length > maxPoints ? normalizedData.filter((_, i) => i % Math.ceil(normalizedData.length / maxPoints) === 0) : normalizedData;
                const speedChartConfig = {
                    labels: sampledData.map(row => row.Time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })),
                    speeds: sampledData.map(row => row.Speed)
                };
                const stopChartConfig = getStopChartData(stops, normalizedData);

                let speedChartImage = null;
                try {
                    const speedCtx = document.getElementById('speedChart').getContext('2d');
                    if (!speedCtx) throw new Error('Speed Chart canvas not found');
                    document.getElementById('speedChart').width = 600;
                    document.getElementById('speedChart').height = 400;
                    if (speedChartInstance) speedChartInstance.destroy();
                    speedChartInstance = new Chart(speedCtx, {
                        type: 'line',
                        data: { labels: speedChartConfig.labels, datasets: [{ label: 'Speed', data: speedChartConfig.speeds, borderColor: '#00008B', borderWidth: 2, pointRadius: 0, fill: false, tension: 0.4 }] },
                        options: { responsive: false, animation: false, scales: { x: { title: { display: true, text: 'Time' } }, y: { title: { display: true, text: 'Speed (kmph)' }, beginAtZero: true } }, plugins: { legend: { display: false } } }
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
                                img.onload = () => { tempCtx.drawImage(img, 0, 0, 600, 400); resolve(tempCanvas.toDataURL('image/png', 1.0)); speedChartInstance.destroy(); };
                            }
                        };
                        speedChartInstance.update();
                    });
                } catch (err) {
                    console.error('Error generating speed chart image:', err);
                }

                let stopChartImage = null;
                try {
                    const stopCtx = document.getElementById('stopChart').getContext('2d');
                    if (!stopCtx) throw new Error('Stop Chart canvas not found');
                    document.getElementById('stopChart').width = 600;
                    document.getElementById('stopChart').height = 400;
                    if (stopChartInstance) stopChartInstance.destroy();
                    stopChartInstance = new Chart(stopCtx, {
                        type: 'line',
                        data: { labels: stopChartConfig.labels, datasets: stopChartConfig.datasets },
                        options: { responsive: false, animation: false, scales: { x: { title: { display: true, text: 'Distance Before Stop (m)' } }, y: { title: { display: true, text: 'Speed (kmph)' }, beginAtZero: true } }, plugins: { legend: { display: true, position: 'top' }, title: { display: true, text: 'Speed vs. Distance Before Stop' } } }
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
                                img.onload = () => { tempCtx.drawImage(img, 0, 0, 600, 400); resolve(tempCanvas.toDataURL('image/png', 1.0)); stopChartInstance.destroy(); };
                            }
                        };
                        stopChartInstance.update();
                    });
                } catch (err) {
                    console.error('Error generating stop chart image:', err);
                }

                const reportData = {
                    trainDetails: [
                        { label: 'Loco Number', value: locoNumber }, { label: 'Train Number', value: trainNumber },
                        { label: 'Type of Rake', value: rakeType }, { label: 'Max Permissible Speed', value: `${maxPermissibleSpeed} kmph` },
                        { label: 'Section', value: section }, { label: 'Route', value: routeSection }, { label: 'SPM Type', value: spmType },
                        { label: 'Analysis By', value: cliName },
                        { label: 'Analysis Time', value: `From ${fromDateTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })} to ${toDateTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}` }
                    ],
                    lpDetails: [ `LP ID: ${lpId}`, `LP Name: ${lpName}`, `Designation: ${lpDesg}`,`Group CLI: ${lpGroupCli || 'N/A'}`, `CUG Number: ${lpCugNumber}`],
                    alpDetails: [ `ALP ID: ${alpId}`, `ALP Name: ${alpName}`, `Designation: ${alpDesg}`, `Group CLI: ${alpGroupCli || 'N/A'}`,`CUG Number: ${alpCugNumber}`],
                    stopCount: stops.length, bftDetails, bptDetails, crewCallData, stops, stationStops,
                    overSpeedDetails, wheelSlipDetails, wheelSkidDetails,
                    speedRangeSummary, sectionSpeedSummary,
                    speedChartConfig, stopChartConfig, speedChartImage, stopChartImage
                };

                localStorage.setItem('spmReportData', JSON.stringify(reportData));
                window.location.href = 'report.html';

            } catch (error) {
                console.error('Error processing RTIS file:', error);
                alert(`Processing failed: ${error.message}`);
                if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(false);
            }
        };
        reader.onerror = () => {
            alert('Failed to read the SPM file.');
            if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(false);
        };

        if (fileExt === 'csv') {
            reader.readAsText(spmFile, 'UTF-8');
        } else {
            reader.readAsArrayBuffer(spmFile);
        }

    } catch (error) {
        console.error('Error during submission:', error);
        alert(`An error occurred: ${error.message}`);
        if (window.toggleLoadingOverlay) window.toggleLoadingOverlay(false);
    }
});

// ---------- Helper analysis functions (existing logic kept) ----------

function getOverSpeedDetails(data, maxSpeed, stations) {
    const details = []; let group = null;
    data.forEach((row, index) => {
        if (row.Speed > maxSpeed) {
            let sectionName = stations.slice(0, -1).find((s, i) => row.Distance >= s.distance && row.Distance < stations[i + 1].distance);
            sectionName = sectionName ? `${sectionName.name}-${stations[stations.indexOf(sectionName) + 1].name}` : 'Unknown';
            if (!group || group.section !== sectionName || (index > 0 && (row.Time.getTime() - data[index-1].Time.getTime()) > 10000)) {
                if (group) details.push({ ...group, timeRange: `${group.startTime.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:false})}-${group.endTime.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:false})}`, speedRange: `${group.minSpeed.toFixed(0)}-${group.maxSpeed.toFixed(0)}` });
                group = { section: sectionName, startTime: row.Time, endTime: row.Time, minSpeed: row.Speed, maxSpeed: row.Speed };
            } else {
                group.endTime = row.Time;
                group.minSpeed = Math.min(group.minSpeed, row.Speed);
                group.maxSpeed = Math.max(group.maxSpeed, row.Speed);
            }
        } else if (group) {
            details.push({ ...group, timeRange: `${group.startTime.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:false})}-${group.endTime.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:false})}`, speedRange: `${group.minSpeed.toFixed(0)}-${group.maxSpeed.toFixed(0)}` });
            group = null;
        }
    });
    if (group) details.push({ ...group, timeRange: `${group.startTime.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:false})}-${group.endTime.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:false})}`, speedRange: `${group.minSpeed.toFixed(0)}-${group.maxSpeed.toFixed(0)}` });
    return details;
}

function getWheelSlipAndSkidDetails(data, stations) {
    const wheelSlipDetails = [], wheelSkidDetails = [];
    data.forEach((row, index) => {
        if (index === 0) return;
        const prevRow = data[index - 1];
        const timeDiffSec = (row.Time.getTime() - prevRow.Time.getTime()) / 1000;
        if (timeDiffSec <= 0 || timeDiffSec > 5) return;
        const speedDiff = (row.Speed - prevRow.Speed) / timeDiffSec;
        let sectionName = stations.slice(0, -1).find((s, i) => row.Distance >= s.distance && row.Distance < stations[i + 1].distance);
        sectionName = sectionName ? `${sectionName.name}-${stations[stations.indexOf(sectionName) + 1].name}` : 'Unknown';
        if (speedDiff >= 4) wheelSlipDetails.push({ section: sectionName, timeRange: `${prevRow.Time.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:false})}-${row.Time.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:false})}`, speedRange: `${prevRow.Speed.toFixed(0)}-${row.Speed.toFixed(0)}` });
        if (speedDiff <= -5) wheelSkidDetails.push({ section: sectionName, timeRange: `${prevRow.Time.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:false})}-${row.Time.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:false})}`, speedRange: `${prevRow.Speed.toFixed(0)}-${row.Speed.toFixed(0)}` });
    });
    return { wheelSlipDetails, wheelSkidDetails };
}

function getStopDetails(data, stopCode, section, fromDist, stations, rakeType) {
    let potentialStops = [];
    data.forEach((row, i) => { if (row.EventGn === stopCode && row.Speed === 0) potentialStops.push({ index: i, time: row.Time, kilometer: row.Distance }); });
    let stops = []; let currentGroup = [];
    potentialStops.forEach((stop, i) => {
        currentGroup.push(stop);
        const isLast = i === potentialStops.length - 1 || (potentialStops[i + 1].time.getTime() - stop.time.getTime()) > 10000;
        if (isLast && currentGroup.length > 0) { stops.push(currentGroup[0]); currentGroup = []; }
    });
    stops = stops.filter((stop, i, arr) => i === 0 || Math.abs(stop.kilometer - arr[i - 1].kilometer) >= 200);
    let processedStops = stops.map((stop, stopIndex) => {
        let startTimeObject = null;
        for (let i = stop.index + 1; i < data.length; i++) { if (data[i].Speed > 0) { startTimeObject = data[i].Time; break; } }
        const duration = startTimeObject ? (startTimeObject.getTime() - stop.time.getTime()) / 1000 : 0;
        return { ...stop, duration, isLastStopOfJourney: stopIndex === stops.length - 1 };
    });
    stops = processedStops.filter(stop => stop.duration >= 10 || stop.isLastStopOfJourney);
    stops.forEach((stop, index) => {
        stop.group = index + 1;
        stop.timeString = stop.time.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        let startTimeObject = null;
        for (let i = stop.index + 1; i < data.length; i++) { if (data[i].Speed > 0) { startTimeObject = data[i].Time; break; } }
        stop.startTiming = startTimeObject ? startTimeObject.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) : 'N/A';
        let atStation = window.stationSignalData.find(row => row['SECTION'] === section && Math.abs((parseFloat(row['CUMMULATIVE DISTANT(IN Meter)']) - fromDist) - stop.kilometer) <= 400);
        if (atStation) stop.stopLocation = `${atStation['STATION']} ${atStation['SIGNAL NAME'] || ''}`.trim();
        else { let sec = stations.slice(0, -1).find((s, i) => stop.kilometer >= s.distance && stop.kilometer < stations[i+1].distance); stop.stopLocation = sec ? `${sec.name}-${stations[stations.indexOf(sec) + 1].name}` : 'Unknown'; }

        // --- रायपुर स्टैंडर्ड: 11-पॉइंट्स ब्रेकिंग ---
        const targetList = [2000, 1000, 800, 600, 500, 400, 300, 100, 50, 20, 0];

        const speedsBefore = targetList.map(d => {
            const sp = getSpeedAtDistanceBeforeStop(stop.index, stop.kilometer, data, d);
            return (sp === null || sp === undefined) ? '0' : Number(sp).toFixed(0);
        });

        // स्मूथ/लेट एनालिसिस के लिए 5 मुख्य चेकपॉइंट्स (Index Mapping)
        const s2000 = parseFloat(speedsBefore[0]); // 2000m
        const s1000 = parseFloat(speedsBefore[1]); // 1000m
        const s500  = parseFloat(speedsBefore[4]); // 500m
        const s100  = parseFloat(speedsBefore[7]); // 100m
        const s50   = parseFloat(speedsBefore[8]); // 50m

        let isSmooth = false;
        if (rakeType === 'GOODS') {
            // Goods सीमाएं: 55, 40, 25, 15, 10
            isSmooth = (s2000 <= 55 && s1000 <= 40 && s500 <= 25 && s100 <= 15 && s50 <= 10);
        } else {
            // Coaching सीमाएं: 100, 60, 50, 30, 15
            isSmooth = (s2000 <= 100 && s1000 <= 60 && s500 <= 50 && s100 <= 30 && s50 <= 15);
        }

        stop.brakingTechnique = isSmooth ? 'Smooth' : 'Late';
        stop.speedsBefore = speedsBefore; // अब यह 11 वैल्यूज़ भेजेगा
    });
    return stops;
}

function getStationArrivalDeparture(stations, stops, filteredData, normalizedData, from, to) {
    const timeFormat = { timeZone: 'Asia/Kolkata', hour12: false, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    return stations.map((station, index) => {
        let arrival = 'N/A', departure = 'N/A';
        const stationStop = stops.find(s => s.stopLocation && s.stopLocation.startsWith(station.name));
        if (stationStop) {
            arrival = stationStop.timeString;
            departure = stationStop.startTiming;
        } else {
            if (index === 0 && station.name === from) {
                departure = filteredData[0].Time.toLocaleString('en-IN', timeFormat);
            } else {
                let crossPoint = normalizedData.find((d, i, arr) => i > 0 && ((arr[i-1].Distance < station.distance && d.Distance >= station.distance) || (arr[i-1].Distance > station.distance && d.Distance <= station.distance)));
                if (crossPoint) {
                    if (index === stations.length - 1 && station.name === to) arrival = crossPoint.Time.toLocaleString('en-IN', timeFormat);
                    else departure = crossPoint.Time.toLocaleString('en-IN', timeFormat);
                }
            }
        }
        if (index === stations.length - 1) departure = 'N/A';
        return { station: station.name, arrival, departure };
    });
}

function calculateSpeedRangeSummary(data, rakeType, mps) {
    const ranges = rakeType === 'COACHING' ? {'Above 130': v=>v>130, '125-130': v=>v>=125&&v<=130, '110-125': v=>v>=110&&v<125, '90-110': v=>v>=90&&v<110, 'Below 90': v=>v<90} : {'Above 80': v=>v>80, '75-80': v=>v>=75&&v<=80, '60-75': v=>v>=60&&v<75, '40-60': v=>v>=40&&v<60, 'Below 40': v=>v<40};
    const distByRange = Object.keys(ranges).reduce((acc, k) => ({...acc, [k]: 0}), {});
    let totalDist = 0, distAtMps = 0;
    for (let i = 1; i < data.length; i++) {
        const distDiff = Math.abs(data[i].Distance - data[i-1].Distance);
        if (distDiff > 0) {
            totalDist += distDiff;
            const avgSpeed = (data[i].Speed + data[i-1].Speed) / 2;
            if (Math.round(avgSpeed) === mps) distAtMps += distDiff;
            for (const rangeName in ranges) if (ranges[rangeName](avgSpeed)) { distByRange[rangeName] += distDiff; break; }
        }
    }
    const summary = Object.entries(distByRange).map(([r, d]) => ({speedRange: `${r} Kmph`, distance: (d/1000).toFixed(2), percentage: totalDist>0 ? ((d/totalDist)*100).toFixed(2):'0.00'}));
    summary.unshift({speedRange: `AT MPS (${mps} Kmph)`, distance: (distAtMps/1000).toFixed(2), percentage: totalDist>0 ? ((distAtMps/totalDist)*100).toFixed(2):'0.00'});
    return { summary, totalDistance: (totalDist/1000).toFixed(2) };
}

function calculateSectionSpeedSummary(data, stations, from, to) {
    const summary = [];
    for (let i = 0; i < stations.length - 1; i++) {
        const startStation = stations[i];
        const endStation = stations[i+1];
        const sectionName = `${startStation.name}-${endStation.name}`;
        const sectionData = data.filter(d => d.Distance >= startStation.distance && d.Distance < endStation.distance);
        if (sectionData.length > 0) {
            const speeds = sectionData.map(d => d.Speed).filter(s => s > 0);
            let modeSpeed = 'N/A', maxSpeed = 'N/A', averageSpeed = 'N/A';
            if (speeds.length > 0) {
                maxSpeed = Math.max(...speeds).toFixed(0);
                averageSpeed = (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(0);
                const freq = {}; let maxFreq = 0;
                speeds.forEach(s => {
                    const speedInt = Math.floor(s);
                    freq[speedInt] = (freq[speedInt] || 0) + 1;
                    if (freq[speedInt] > maxFreq) { maxFreq = freq[speedInt]; modeSpeed = speedInt; }
                });
            }
            summary.push({ section: sectionName, modeSpeed, maxSpeed, averageSpeed });
        }
    }
    const overallSpeeds = data.map(d => d.Speed).filter(s => s > 0);
    let overallModeSpeed = 'N/A', overallMaxSpeed = 'N/A', overallAverageSpeed = 'N/A';
    if (overallSpeeds.length > 0) {
        overallMaxSpeed = Math.max(...overallSpeeds).toFixed(0);
        overallAverageSpeed = (overallSpeeds.reduce((a, b) => a + b, 0) / overallSpeeds.length).toFixed(0);
        const overallFreq = {}; let overallMaxFreq = 0;
        overallSpeeds.forEach(s => {
            const speedInt = Math.floor(s);
            overallFreq[speedInt] = (overallFreq[speedInt] || 0) + 1;
            if (overallFreq[speedInt] > overallMaxFreq) { overallMaxFreq = overallFreq[speedInt]; overallModeSpeed = speedInt; }
        });
    }
    summary.push({ section: `<strong>${from}-${to} (Overall)</strong>`, modeSpeed: overallModeSpeed, maxSpeed: overallMaxSpeed, averageSpeed: overallAverageSpeed });
    return summary;
}

function getStopChartData(stops, data) {
    // Line 420 के आसपास इसे बदलें:
    const distanceLabels = [2000, 1000, 800, 600, 500, 400, 300, 100, 50, 20, 0];
    const datasets = stops.slice(0, 10).map((stop, index) => {
        const speeds = distanceLabels.map(targetDistance => {
            const sp = getSpeedAtDistanceBeforeStop(stop.index, stop.kilometer, data, targetDistance);
            return sp ? sp : 0;
        });
        const colors = ['#FF0000', '#0000FF', '#008000', '#FFA500', '#800080', '#00FFFF', '#FF00FF', '#808000', '#000080', '#800000'];
        return { label: stop.stopLocation ? stop.stopLocation.substring(0, 20) : `Stop ${index+1}`, data: speeds, borderColor: colors[index % colors.length], fill: false, tension: 0.2 };
    });
    return { labels: distanceLabels, datasets };
}
