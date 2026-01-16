

require('dotenv').config();

const BASE_URL = 'http://127.0.0.1:3000/api';

async function test() {
    try {
        console.log("1. Fetching Batch 229 (Old Completed)...");
        const oldRes = await fetch(`${BASE_URL}/batches/229`);
        const oldData = await oldRes.json();
        const oldBatch = oldData.batch;
        console.log(`[Batch 229] ID: ${oldBatch.id} | Status: ${oldBatch.status} | Completed: ${oldBatch.completed_count}/${oldBatch.total_transactions}`);

        console.log("\n2. Creating New Batch...");
        const createRes = await fetch(`${BASE_URL}/batches`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                batch_number: "TEST-BATCH-DEBUG",
                detail: "Debug Freeze",
                description: "Testing API logic"
            })
        });
        const newBatch = await createRes.json();
        const newId = newBatch.id;
        console.log(`[New Batch] Created ID: ${newId}`);

        console.log(`\n3. Fetching New Batch ${newId} Details...`);
        const newDetailRes = await fetch(`${BASE_URL}/batches/${newId}`);
        const newDetailData = await newDetailRes.json();
        const newDetail = newDetailData.batch;
        console.log(`[New Batch] ID: ${newDetail.id} | Status: ${newDetail.status} | Completed: ${newDetail.completed_count}/${newDetail.total_transactions}`);

        if (newDetail.id !== newId) {
            console.error("❌ API returned wrong batch ID!");
        } else if (parseInt(newDetail.completed_count) !== 0) {
            console.error("❌ New batch has non-zero completed count!");
        } else {
            console.log("✅ API behavior seems correct (ID matches, Count is 0). Problem likely in Frontend State.");
        }

    } catch (e) {
        console.error("Error:", e.message);
    }
}

test();

