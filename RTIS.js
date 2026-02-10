// RTIS.js - Updated Logic for SANKET

/**
 * Main Processing Function triggered from index.html
 */
async function processRTISData(file, inputs) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            complete: async function(results) {
                try {
                    const data = results.data;
                    
                    // --- CONNECTION POINT ---
                    // Index.html ने जो डेटा 'window.stationData' में रखा था, उसे यहाँ उठाओ
                    const stationMap = window.stationData || []; 

                    if (stationMap.length === 0) {
                        console.warn("Warning: Station Data not found in memory!");
                    }

                    const analyzedData = performAnalysis(data, inputs, stationMap);
                    resolve(analyzedData);
                } catch (e) {
                    reject(e);
                }
            },
            error: function(err) {
                reject(err);
            }
        });
    });
}

function performAnalysis(rawData, inputs, stationMap) {
    // 1. Basic Parsing, Cleaning & MAPPING
    const cleanData = rawData.map(row => {
        const dist = parseFloat(row['Distance'] || 0);
        let locationName = row['Location'] || '';

        // --- MAPPING LOGIC START (Station/Signal Identification) ---
        // अगर लोकेशन खाली है, तो हम Station CSV (stationMap) में ढूंढेंगे
        if (!locationName && stationMap.length > 0) {
            // हम +- 50 मीटर की रेंज में सिग्नल ढूंढेंगे
            const match = stationMap.find(s => {
                const signalDist = parseFloat(s['CUMMULATIVE DISTANT(IN Meter)']);
                return Math.abs(signalDist - dist) <= 50; 
            });

            if (match) {
                locationName = match['SIGNAL NAME']; // e.g., "NGP HOME"
            } else {
                locationName = `KM ${dist.toFixed(2)}`; // e.g., "KM 150.25"
            }
        }
        // --- MAPPING LOGIC END ---

        return {
            time: row['Gps Time'] || row['Time'], 
            speed: parseFloat(row['Speed'] || 0),
            distance: dist,
            location: locationName
        };
    }).filter(d => d.time);

    // 2. Identify Stops (Speed = 0)
    const stops = identifyStops(cleanData);

    // 3. Run Logic Analysis
    const analysisResults = {
        inputs: inputs,
        stops: [],
        bftStatus: "Not Done",
        bptStatus: "Not Done",
        overspeedCount: 0,
        maxSpeed: 0,
        totalDist: 0, 
        avgSpeed: 0,  
        uniqueTripId: `${inputs.trainNo}_${inputs.journeyDate}_${new Date().getTime()}`
    };

    // Calculate Summary Stats
    if (cleanData.length > 0) {
        analysisResults.maxSpeed = Math.max(...cleanData.map(d => d.speed));
        // Total Dist calculation (Last KM - First KM)
        analysisResults.totalDist = (cleanData[cleanData.length-1].distance - cleanData[0].distance).toFixed(2);
        // Avg Speed calculation
        const totalSpeed = cleanData.reduce((acc, curr) => acc + curr.speed, 0);
        analysisResults.avgSpeed = (totalSpeed / cleanData.length).toFixed(1);
    }
    
    // --- BFT / BPT LOGIC ---
    const testResults = analyzeBrakeTests(cleanData, inputs.rakeType);
    analysisResults.bftStatus = testResults.bft;
    analysisResults.bptStatus = testResults.bpt;

    // --- STOP ANALYSIS (Braking Pattern) ---
    analysisResults.stops = stops.map(stop => {
        const approachData = getApproachSpeeds(cleanData, stop.index);
        const quality = analyzeBrakingQuality(inputs.rakeType, inputs.trainLoad, approachData);
        
        return {
            ...stop,
            speeds: approachData,
            analysis: quality,
            remark: quality === "Smooth Braking" ? "OK" : "Check Handling"
        };
    });

    // --- PREPARE GOOGLE SHEET DATA PAYLOAD ---
    analysisResults.sheetPayload = prepareSheetPayload(analysisResults);

    return analysisResults;
}

// --- HELPER: Identify Stops ---
function identifyStops(data) {
    let stops = [];
    let isStopped = false;
    
    for (let i = 0; i < data.length; i++) {
        if (data[i].speed === 0) {
            if (!isStopped) {
                stops.push({
                    index: i,
                    time: data[i].time,
                    location: data[i].location // यह अब Station Mapping से भरा हुआ होगा
                });
                isStopped = true;
            }
        } else {
            isStopped = false;
        }
    }
    return stops;
}

// --- HELPER: Get Speeds at Distances ---
// (यह फंक्शन ट्रेन के रुकने से पहले की स्पीड निकालता है)
function getApproachSpeeds(data, stopIndex) {
    // यहाँ हमें 'stopIndex' से पीछे (backward) जाना होगा
    // और देखना होगा कि 2000m, 1000m पहले स्पीड क्या थी।
    
    let currentDist = data[stopIndex].distance;
    let speeds = { 2000:0, 1000:0, 800:0, 600:0, 500:0, 400:0, 300:0, 100:0, 50:0, 20:0, 0:0 };
    
    // Reverse Loop (stop से पीछे की तरफ)
    for (let i = stopIndex; i >= 0; i--) {
        let dDiff = Math.abs(currentDist - data[i].distance);
        
        // Closest match logic for each marker
        if (Math.abs(dDiff - 2000) < 10) speeds[2000] = data[i].speed;
        if (Math.abs(dDiff - 1000) < 10) speeds[1000] = data[i].speed;
        if (Math.abs(dDiff - 800) < 10)  speeds[800]  = data[i].speed;
        if (Math.abs(dDiff - 600) < 10)  speeds[600]  = data[i].speed;
        if (Math.abs(dDiff - 500) < 10)  speeds[500]  = data[i].speed;
        if (Math.abs(dDiff - 400) < 10)  speeds[400]  = data[i].speed;
        if (Math.abs(dDiff - 300) < 10)  speeds[300]  = data[i].speed;
        if (Math.abs(dDiff - 100) < 10)  speeds[100]  = data[i].speed;
        if (Math.abs(dDiff - 50) < 5)    speeds[50]   = data[i].speed;
        if (Math.abs(dDiff - 20) < 5)    speeds[20]   = data[i].speed;
        
        // 2.5 KM पीछे चले गए तो लूप बंद करो (Optimization)
        if (dDiff > 2500) break;
    }
    
    speeds[0] = 0; // Stop point
    return speeds; 
}

// --- CORE LOGIC: Braking Pattern (As per Rules) ---
function analyzeBrakingQuality(rakeType, loadType, speeds) {
    
    if (rakeType === 'GOODS') {
        // GOODS RULES
        if (
            speeds[2000] <= 55 &&
            speeds[1000] <= 40 &&
            speeds[500]  <= 25 &&
            speeds[100]  <= 15 &&
            speeds[50]   <= 10
        ) {
            return "Smooth Braking";
        }
    } else {
        // COACHING / MEMU RULES
        if (
            speeds[2000] <= 100 &&
            speeds[1000] <= 60 &&
            speeds[500]  <= 50 &&
            speeds[100]  <= 30 &&
            speeds[50]   <= 15
        ) {
            return "Smooth Braking";
        }
    }
    return "Late Braking";
}

// --- CORE LOGIC: BFT / BPT ---
function analyzeBrakeTests(data, rakeType) {
    let bftStatus = "Not Done";
    let bptStatus = "Not Done";

    // Rules
    let rules = {
        minSpeed: 12, maxSpeed: 23, drop: 5, bptDropFactor: 0.40
    };

    if (rakeType === 'GOODS') {
        rules = { minSpeed: 12, maxSpeed: 24, drop: 5, bptDropFactor: 0.40 };
    } 
    // Coaching rules are default above

    // Logic: Iterate data to find speed drops
    // (Simplified logic for demonstration - Full logic requires checking 90 sec window)
    
    for (let i = 0; i < data.length - 10; i++) {
        let startSpeed = data[i].speed;
        
        // Check BFT Range
        if (startSpeed >= rules.minSpeed && startSpeed <= rules.maxSpeed) {
            // Check next 90 seconds (assuming 1 row = 1 sec approx)
            for (let j = i+1; j < i+90 && j < data.length; j++) {
                let currentSpeed = data[j].speed;
                let drop = startSpeed - currentSpeed;
                
                if (drop >= 5) {
                    bftStatus = "PASS";
                }
            }
        }

        // Check BPT Range
        // (Similar logic for BPT with 40% drop)
    }

    return { bft: bftStatus, bpt: bptStatus }; 
}

// --- DATA PREPARATION ---
function prepareSheetPayload(res) {
    const inp = res.inputs;
    
    const recordRow = {
        "DateTime": new Date().toLocaleString(),
        "CLI Name": inp.cliName,
        "Journey Date": inp.journeyDate,
        "Train No": inp.trainNo,
        "Loco No": inp.locoNo,
        "From Stn": inp.fromStn,
        "To Stn": inp.toStn,
        "Rake Type": inp.rakeType,
        "MPS": inp.mps,
        "Section": inp.section,
        "LP ID": inp.lpId,
        "LP Name": inp.lpName,
        "LP Group CLI": inp.lpGroupCli,
        "ALP ID": inp.alpId,
        "ALP Name": inp.alpName,
        "ALP Group CLI": inp.alpGroupCli,
        "BFT Status": res.bftStatus,
        "BPT Status": res.bptStatus,
        "Overspeed Count": res.overspeedCount,
        "Total Dist": res.totalDist,
        "Avg Speed": res.avgSpeed,
        "Max Speed": res.maxSpeed,
        "CLI Obs": "",
        "Action Taken": "", 
        "UNIQUE_TRIP_ID": res.uniqueTripId
    };

    const brakingRows = res.stops.map(stop => ({
        "Date": inp.journeyDate,
        "Train No": inp.trainNo,
        "LP ID": inp.lpId,
        "LP Name": inp.lpName,
        "Location": stop.location,
        "KM": "", 
        "Spd 2000m": stop.speeds[2000],
        "Spd 1000m": stop.speeds[1000],
        "Spd 800m": stop.speeds[800],
        "Spd 600m": stop.speeds[600],
        "Spd 500m": stop.speeds[500],
        "Spd 400m": stop.speeds[400],
        "Spd 300m": stop.speeds[300],
        "Spd 100m": stop.speeds[100],
        "Spd 50m": stop.speeds[50],
        "Spd 20m": stop.speeds[20],
        "Spd 0m": stop.speeds[0],
        "Analysis": stop.analysis,
        "Remark": stop.remark,
        "UNIQUE_TRIP_ID": res.uniqueTripId
    }));

    return { recordRow, brakingRows };
}
