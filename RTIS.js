// RTIS.js - Full Logic Engine

async function processRTISData(file, inputs) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true, skipEmptyLines: true, dynamicTyping: true,
            complete: function(results) {
                const stationMap = window.stationData || [];
                try {
                    const analyzed = performAnalysis(results.data, inputs, stationMap);
                    resolve(analyzed);
                } catch(e) { reject(e); }
            }
        });
    });
}

function performAnalysis(rawData, inputs, stationMap) {
    // 1. CLEAN & MAP
    const cleanData = rawData.map(row => {
        const dist = parseFloat(row['Distance'] || 0);
        let loc = row['Location'] || '';
        
        // Station Mapping (Local DB)
        if(!loc && stationMap.length > 0) {
            const match = stationMap.find(s => Math.abs(parseFloat(s['CUMMULATIVE DISTANT(IN Meter)']) - dist) <= 50);
            if(match) loc = match['SIGNAL NAME'];
            else loc = `KM ${dist.toFixed(2)}`;
        }

        return {
            time: row['Gps Time'] || row['Time'],
            speed: parseFloat(row['Speed'] || 0),
            dist: dist,
            loc: loc
        };
    }).filter(d => d.time);

    // 2. STOPS & BRAKING ANALYSIS
    const stops = [];
    let isStopped = false;
    for(let i=0; i<cleanData.length; i++) {
        if(cleanData[i].speed === 0) {
            if(!isStopped) {
                const analysis = analyzeApproach(cleanData, i, inputs.rakeType);
                stops.push({
                    loc: cleanData[i].loc,
                    time: cleanData[i].time,
                    dist: cleanData[i].dist,
                    speeds: analysis.speeds,
                    result: analysis.result,
                    remark: analysis.result === "Smooth Braking" ? "OK" : "CHECK"
                });
                isStopped = true;
            }
        } else { isStopped = false; }
    }

    // 3. BFT / BPT LOGIC
    const bftResult = { status: "Not Done" }; // Placeholder logic
    const bptResult = { status: "Not Done" }; 
    // (Actual detection requires complex window loop, simplified for structure)
    // Assuming if speed drops 15->10 in range, it passes
    
    // 4. SPEED SUMMARY (Page 8)
    const mps = parseFloat(inputs.mps);
    const summary = {
        atMps: 0, above80: 0, r75_80: 0, r60_75: 0, r40_60: 0, below40: 0
    };
    
    let totalDist = 0;
    if(cleanData.length > 1) {
        totalDist = cleanData[cleanData.length-1].dist - cleanData[0].dist;
        for(let i=1; i<cleanData.length; i++) {
            const d = cleanData[i].dist - cleanData[i-1].dist;
            const s = cleanData[i].speed;
            
            if(s >= mps) summary.atMps += d;
            else if(s > 80) summary.above80 += d;
            else if(s >= 75) summary.r75_80 += d;
            else if(s >= 60) summary.r60_75 += d;
            else if(s >= 40) summary.r40_60 += d;
            else summary.below40 += d;
        }
    }

    // 5. OVERSPEED COUNT
    const osCount = cleanData.filter(d => d.speed > mps).length;
    const maxSpd = Math.max(...cleanData.map(d => d.speed));

    return {
        inputs: inputs,
        stops: stops,
        speedSummary: summary,
        totalDist: totalDist.toFixed(2),
        maxSpeed: maxSpd,
        avgSpeed: (cleanData.reduce((a,b)=>a+b.speed,0)/cleanData.length).toFixed(1),
        overspeedCount: osCount,
        bftStatus: bftResult.status,
        bptStatus: bptResult.status,
        uniqueTripId: `${inputs.trainNo}_${inputs.journeyDate}`
    };
}

function analyzeApproach(data, idx, rake) {
    const curDist = data[idx].dist;
    const speeds = { 2000:'-', 1000:'-', 800:'-', 600:'-', 500:'-', 400:'-', 300:'-', 100:'-', 50:'-', 20:'-', 0:0 };
    
    // Backtrack logic
    for(let i=idx; i>=0; i--) {
        const diff = Math.abs(curDist - data[i].dist);
        if(diff > 2500) break;
        if(Math.abs(diff-2000)<20) speeds[2000] = data[i].speed;
        if(Math.abs(diff-1000)<20) speeds[1000] = data[i].speed;
        if(Math.abs(diff-800)<10) speeds[800] = data[i].speed;
        if(Math.abs(diff-600)<10) speeds[600] = data[i].speed;
        if(Math.abs(diff-500)<10) speeds[500] = data[i].speed;
        if(Math.abs(diff-400)<10) speeds[400] = data[i].speed;
        if(Math.abs(diff-300)<10) speeds[300] = data[i].speed;
        if(Math.abs(diff-100)<10) speeds[100] = data[i].speed;
        if(Math.abs(diff-50)<5) speeds[50] = data[i].speed;
        if(Math.abs(diff-20)<5) speeds[20] = data[i].speed;
    }

    // Rules
    let smooth = true;
    if(rake === 'GOODS') {
        if(speeds[2000]>55 || speeds[1000]>40 || speeds[500]>25 || speeds[100]>15) smooth=false;
    } else {
        if(speeds[2000]>100 || speeds[1000]>60 || speeds[500]>50 || speeds[100]>30) smooth=false;
    }
    return { speeds, result: smooth ? "Smooth Braking" : "Late Braking" };
}
