import { supabase } from '../supabase-init.js';

/**
 * SHARED LOGGING FUNCTION
 */
async function writeLog(action, message, category = 'logs') {
    const { data: { user } } = await supabase.auth.getUser();
    try {
        await supabase.from('system_logs').insert({
            action: action,
            message: message,
            category: category,
            timestamp: new Date().toISOString(),
            email: user ? user.email : "Personnel_01",
            role: "Collector"
        });
    } catch (e) {
        console.error("Logging failed:", e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const binSelectionView = document.getElementById('binSelectionView');
    const binDetailView = document.getElementById('binDetailView');
    const displayBinID = document.getElementById('displayBinID');
    const displayStatus = document.getElementById('displayStatus');
    const backBtn = document.getElementById('backToList');
    const binContainer = document.getElementById('binContainer');
    const binSearch = document.getElementById('binSearch');
    const submitUpdateBtn = document.getElementById('submitUpdate');

    let allBins = {}; 
    let unsubscribeDetail = null; 

    /**
     * 1. TRAFFIC-LIGHT COLOR LOGIC
     */
    function getStatusColor(bin) {
        if (bin.status === "full" || bin.level >= 90) {
            return "#ff4444"; // Red
        } else if (bin.level >= 50 || bin.status === "filling") {
            return "#ffbb33"; // Yellow
        }
        return "#99cc33"; // Green
    }

    /**
     * 2. FETCH ALL BINS (LIST VIEW)
     */
    const loadBins = async () => {
        const { data, error } = await supabase.from('bins').select('*');
        if (error) { console.error(error); return; }
        if (!data) {
            binContainer.innerHTML = '<p style="text-align:center; padding:20px; color:#aaa;">No bins found.</p>';
            allBins = {};
            return;
        }
        allBins = Object.fromEntries(data.map(bin => [bin.id, bin]));
        renderBins(allBins, binSearch.value);
    };
    loadBins();

    function renderBins(bins, filter = "") {
        binContainer.innerHTML = ""; 
        Object.keys(bins).forEach(id => {
            const bin = bins[id];
            const binDisplayId = id.replace('bin_', '#');
            if (binDisplayId.toLowerCase().includes(filter.toLowerCase())) {
                const statusColor = getStatusColor(bin);
                const card = document.createElement('div');
                card.className = 'bin-card clickable-bin';
                card.innerHTML = `
                    <div class="bin-card-content">
                        <span>BIN ${binDisplayId}</span>
                        <small class="sample-label" style="color: ${statusColor}; font-weight: bold;">
                            ${bin.status.toUpperCase()}
                        </small>
                    </div>
                    <span class="chevron" style="color: ${statusColor}">›</span>
                `;
                card.onclick = () => showDetail(id);
                binContainer.appendChild(card);
            }
        });
    }

    /**
     * 3. SHOW DETAIL VIEW (WITH LIVE LISTENER)
     */
    function showDetail(binId) {
        if (unsubscribeDetail) unsubscribeDetail();

        const loadBin = async () => {
            const { data: bin, error } = await supabase.from('bins').select('*').eq('id', binId).single();
            if (error) { console.error(error); return; }
            if (!bin) {
                alert("This bin has been disconnected or removed.");
                closeDetailView();
                return;
            }

            displayBinID.innerText = binId.replace('bin_', 'BIN #');
            displayStatus.innerText = bin.status.toUpperCase();
            
            const detailColor = getStatusColor(bin);
            const indicator = document.querySelector('.status-indicator');
            indicator.style.color = detailColor;
            document.querySelectorAll('.status-dot').forEach(dot => {
                dot.style.background = detailColor;
            });
        };
        loadBin();

        binSelectionView.style.display = 'none';
        binDetailView.style.display = 'block';
    }

    /**
     * 4. SEARCH LOGIC
     */
    binSearch.addEventListener('input', (e) => {
        renderBins(allBins, e.target.value);
    });

    /**
     * 5. SUBMIT INCIDENT REPORT & NOTIFY CITIZENS
     */
    submitUpdateBtn.addEventListener('click', async () => {
        const selected = document.querySelector('input[name="issue"]:checked');
        const binKey = displayBinID.innerText.replace('BIN #', 'bin_');
        let issueText = selected ? selected.value : "Routine Checkup";
        if (issueText === "Others") {
            const otherInput = document.getElementById('otherIssueInput');
            issueText = otherInput ? otherInput.value : "Other Unspecified Issue";
        }

        try {
            // Fetch bin data to get the barangay
            const { data: binData } = await supabase.from('bins').select('*').eq('id', binKey).single();
            const binBarangay = binData ? binData.barangay : "Global";

            // 1. Submit detailed report[cite: 8]
            await supabase.from('reports').insert({
                binId: binKey,
                issue: issueText,
                timestamp: new Date().toISOString(),
                collector: (await supabase.auth.getUser()).data.user?.email || "Personnel_01" 
            });

            // 2. TRIGGER CITIZEN NOTIFICATION
            let customMessage = `Collector reported "${issueText}" for ${binKey.replace('bin_', 'Bin #')}`;
            let notifType = "warning"; 

            // Use .includes() to be safer if the text varies slightly
            if (issueText.includes("Overflowing")) {
                customMessage = `Your ${binKey.replace('bin_', 'Bin #')} reported as overflowing, pls monitor and dispose before the bin is full.`;
            } else if (issueText.includes("Damaged")) {
                customMessage = `Be careful using ${binKey.replace('bin_', 'Bin #')}, it has been reported as damaged and is awaiting maintenance.`;
                notifType = "cancellation"; 
            }

            await supabase.from('notifications').insert({
                title: "Bin Management Alert",
                message: customMessage,
                barangay: binBarangay, 
                type: notifType,
                status: "unread",
                created_at: new Date().toISOString()
            });

            // 3. Log the system action[cite: 8]
            await writeLog("Bin Reported", `Citizen notification sent to Brgy. ${binBarangay} for ${binKey}`, "logs");
            
            alert(`Success! Report filed and citizens in Brgy. ${binBarangay} have been notified.`);
            closeDetailView();
        } catch (error) {
            console.error("Update failed:", error);
            alert("Error updating bin status.");
        }
    });

    /**
     * 6. NAVIGATION HELPERS
     */
    function closeDetailView() {
        if (unsubscribeDetail) unsubscribeDetail(); 
        
        binDetailView.style.display = 'none';
        binSelectionView.style.display = 'block';
        
        document.querySelectorAll('input[name="issue"]').forEach(el => el.checked = false);
        const otherInput = document.getElementById('otherIssueInput');
        if (otherInput) otherInput.value = "";
    }

    backBtn.addEventListener('click', closeDetailView);
});