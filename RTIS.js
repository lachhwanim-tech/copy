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
                    const analyzedData = performAnalysis(data, inputs);
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

function performAnalysis(rawData, inputs) {
    // 1. Basic Parsing & Cleaning
    // (Assume rawData has Time, Speed, Distance columns)
    const cleanData = rawData.map(row => ({
        time: row['Gps Time'] || row['Time'], // Adjust based on your CSV header
        speed: parseFloat(row['Speed'] || 0),
        distance: parseFloat(row['Distance'] || 0),
        location: row['Location'] || '' // If mapped from signal csv
    })).filter(d => d.time);

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
        totalDist: 0, // Calculate from data
        avgSpeed: 0,  // Calculate from data
        uniqueTripId: `${inputs.trainNo}_${inputs.journeyDate}_${new Date().getTime()}`
    };

    // Calculate Summary Stats
    analysisResults.maxSpeed = Math.max(...cleanData.map(d => d.speed));
    
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
                // Found a new stop
                stops.push({
                    index: i,
                    time: data[i].time,
                    location: data[i].location || `KM ${data[i].distance}`
                });
                isStopped = true;
            }
        } else {
            isStopped = false;
        }
    }
    return stops;
}

// --- HELPER: Get Speeds at Distances (2000m, 1000m...) ---
function getApproachSpeeds(data, stopIndex) {
    // Logic to find speed at X meters before stopIndex
    // This requires calculating cumulative distance backward from stop
    // Simplified for logic demonstration:
    let speeds = { 2000:0, 1000:0, 800:0, 600:0, 500:0, 400:0, 300:0, 100:0, 50:0, 20:0, 0:0 };
    
    // *Actual implementation needs distance calculation loop here*
    // Assuming we populated 'speeds' correctly from data...
    
    return speeds; 
}

// --- CORE LOGIC: Braking Pattern ---
function analyzeBrakingQuality(rakeType, loadType, speeds) {
    // speeds object: { 2000: val, 1000: val, 500: val, 100: val, 50: val ... }
    
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
    // Rules Configuration
    const rules = {
        GOODS: {
            BFT: { min: 12, max: 24, time: 90 },
            BPT: { min: 35, max: 55, time: 90 }
        },
        COACHING: {
            BFT: { min: 12, max: 23, time: 90 },
            BPT: { min: 55, max: 70, time: 90 }
        },
        MEMU: {
            BFT: { min: 12, max: 23, time: 90 },
            BPT: { min: 55, max: 70, time: 90 }
        }
    };
    
    const rule = rules[rakeType] || rules['COACHING'];
    
    // *Mock Logic for Detection - needs actual loop over data to find drops*
    // Logic: Look for speed drop matching criteria
    
    // Returning dummy for structure check
    return { bft: "Done", bpt: "Not Done" }; 
}

// --- DATA PREPARATION FOR GOOGLE SHEETS ---
function prepareSheetPayload(res) {
    const inp = res.inputs;
    
    // 1. Record Sheet Row
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
        "LP Group CLI": "", // Manual or lookup
        "ALP ID": inp.alpId,
        "ALP Name": inp.alpName,
        "ALP Group CLI": "",
        "BFT Status": res.bftStatus,
        "BPT Status": res.bptStatus,
        "Overspeed Count": res.overspeedCount,
        "Total Dist": res.totalDist,
        "Avg Speed": res.avgSpeed,
        "Max Speed": res.maxSpeed,
        "CLI Obs": "", // Filled in Report Page
        "Action Taken": "", // Filled in Report Page
        "UNIQUE_TRIP_ID": res.uniqueTripId
    };

    // 2. Braking Sheet Rows (Array)
    const brakingRows = res.stops.map(stop => ({
        "Date": inp.journeyDate,
        "Train No": inp.trainNo,
        "LP ID": inp.lpId,
        "LP Name": inp.lpName,
        "Location": stop.location,
        "KM": "", // Extract from location or distance
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
