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
    const incidentReportsSection = document.querySelector('.incident-reports-section');
    const submitUpdateBtn = document.getElementById('submitUpdate');
    const incidentReportsContainer = document.getElementById('myIncidentReports');

    let allBins = {}; 
    let unsubscribeDetail = null; 
    let activeCollectorEmail = null;
    let incidentReportRequest = 0;

    /**
     * 1. TRAFFIC-LIGHT COLOR LOGIC
     */
    function getStatusColor(bin) {
        const status = String(bin.status || '').toLowerCase();
        const fillLevel = bin.level ?? bin.volume ?? 0;
        if (status === "full" || fillLevel >= 90) {
            return "#ff4444"; // Red
        } else if (fillLevel >= 50 || status === "filling") {
            return "#ffbb33"; // Yellow
        }
        return "#99cc33"; // Green
    }

    /**
     * 2. FETCH ALL BINS (LIST VIEW)
     */
    const loadBins = async () => {
        const { data, error } = await supabase.from('bins').select('*');
        if (error) {
            console.error('Unable to load bins:', error);
            binContainer.innerHTML = '<p class="section-message error-message">Unable to load bins. Please try again.</p>';
            return;
        }
        if (!data?.length) {
            binContainer.innerHTML = '<p class="section-message">No bins found.</p>';
            allBins = {};
            return;
        }
        allBins = Object.fromEntries(data.map(bin => [bin.id, bin]));
        renderBins(allBins, binSearch.value);
        if (activeCollectorEmail) loadIncidentReports();
    };
    loadBins();

    function renderBins(bins, filter = "") {
        binContainer.innerHTML = ""; 
        Object.keys(bins).forEach(id => {
            const bin = bins[id];
            const binDisplayId = id.replace('bin_', '#');
            const searchText = `${binDisplayId} ${bin.barangay || ''}`.toLowerCase();
            if (searchText.includes(filter.trim().toLowerCase())) {
                const statusColor = getStatusColor(bin);
                const card = document.createElement('button');
                card.className = 'bin-card clickable-bin';
                card.type = 'button';
                card.setAttribute('aria-label', `View bin ${binDisplayId}, ${bin.status || 'Unknown'}`);

                const content = document.createElement('span');
                content.className = 'bin-card-content';
                const name = document.createElement('span');
                name.className = 'bin-name';
                name.textContent = `BIN ${binDisplayId}`;
                const meta = document.createElement('span');
                meta.className = 'bin-card-meta';
                const fillValue = bin.level ?? bin.volume;
                if (fillValue !== null && fillValue !== undefined) {
                    const fillLevel = document.createElement('span');
                    fillLevel.textContent = `${fillValue}% full`;
                    meta.appendChild(fillLevel);
                }
                const status = document.createElement('span');
                status.className = 'sample-label';
                status.style.color = statusColor;
                status.textContent = String(bin.status || 'Unknown').toUpperCase();
                meta.appendChild(status);
                content.append(name, meta);

                const indicator = document.createElement('span');
                indicator.className = 'bin-status-indicator';
                indicator.style.backgroundColor = statusColor;
                indicator.setAttribute('aria-hidden', 'true');
                const chevron = document.createElement('span');
                chevron.className = 'chevron';
                chevron.textContent = '›';
                card.append(content, indicator, chevron);
                card.addEventListener('click', () => showDetail(id));
                binContainer.appendChild(card);
            }
        });
        if (!binContainer.children.length) {
            binContainer.innerHTML = '<p class="section-message">No bins match your search.</p>';
        }
    }

    const loadIncidentReports = async () => {
        if (!activeCollectorEmail) {
            incidentReportsContainer.innerHTML = '<p class="section-message error-message">Sign in to view your incident reports.</p>';
            return;
        }

        const requestId = ++incidentReportRequest;
        const { data: reports, error } = await supabase.from('reports')
            .select('id, bin_id, issue, timestamp, collector, status')
            .eq('collector', activeCollectorEmail)
            .order('timestamp', { ascending: false })
            .limit(100);

        if (requestId !== incidentReportRequest) return;
        if (error) {
            console.error('Unable to load your incident reports:', error);
            incidentReportsContainer.innerHTML = '<p class="section-message error-message">Unable to load your reports. Please try again.</p>';
            return;
        }

        const activeReports = (reports || []).filter(report =>
            String(report.status || 'Pending').toLowerCase() !== 'resolved'
        );
        if (!activeReports.length) {
            incidentReportsContainer.innerHTML = '<p class="section-message">No active incident reports.</p>';
            return;
        }

        incidentReportsContainer.replaceChildren();
        activeReports.forEach(report => {
            const statusText = report.status || 'Pending';
            const normalizedStatus = statusText.toLowerCase().replace(/\s+/g, '-');
            const bin = allBins[report.bin_id];
            const card = document.createElement('article');
            card.className = 'incident-report-card';

            const header = document.createElement('div');
            header.className = 'incident-report-header';
            const binName = document.createElement('h3');
            binName.textContent = report.bin_id ? report.bin_id.replace(/^bin_/, 'BIN ') : 'Bin not specified';
            const status = document.createElement('span');
            status.className = `incident-status status-${normalizedStatus}`;
            status.textContent = statusText;
            header.append(binName, status);

            const issue = document.createElement('p');
            issue.className = 'incident-report-issue';
            issue.textContent = report.issue || 'Reported issue';
            const location = document.createElement('p');
            location.className = 'incident-report-location';
            location.textContent = bin?.barangay ? `Area: ${bin.barangay}` : 'Area not available';
            const timestamp = document.createElement('time');
            timestamp.className = 'incident-report-time';
            timestamp.dateTime = report.timestamp || '';
            timestamp.textContent = formatReportDate(report.timestamp);

            card.append(header, issue, location, timestamp);
            incidentReportsContainer.appendChild(card);
        });
    };

    const formatReportDate = value => {
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? 'Date unavailable'
            : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    };

    const initializeIncidentReports = async () => {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error) {
            console.error('Unable to verify collection personnel session:', error);
            incidentReportsContainer.innerHTML = '<p class="section-message error-message">Unable to verify your account.</p>';
            return;
        }
        if (!user?.email) {
            incidentReportsContainer.innerHTML = '<p class="section-message error-message">Sign in to view your incident reports.</p>';
            return;
        }

        activeCollectorEmail = user.email;
        await loadIncidentReports();

        const reportChannel = supabase.channel(`collector-reports-${user.id}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'reports',
                filter: `collector=eq.${user.email}`
            }, loadIncidentReports)
            .subscribe(status => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.error(`Incident report realtime subscription failed: ${status}`);
                }
            });

        window.addEventListener('pagehide', () => {
            supabase.removeChannel(reportChannel);
        }, { once: true });
    };

    initializeIncidentReports();

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

        // Hide the bin selection page
        binSelectionView.style.display = 'none';
        // Hide incident reports section
        incidentReportsSection.style.display = 'none';
        // Display the bin details page
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
        if (!selected) {
            alert('Please select an incident type before submitting.');
            return;
        }
        const binKey = displayBinID.innerText.replace('BIN #', 'bin_');
        let issueText = selected ? selected.value : "Routine Checkup";
        if (issueText === "Others") {
            const otherInput = document.getElementById('otherIssueInput');
            issueText = otherInput ? otherInput.value : "Other Unspecified Issue";
        }

        try {
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            if (userError) throw userError;
            if (!user?.email) throw new Error('You must be signed in to submit an incident report.');

            // Fetch bin data to get the barangay
            const { data: binData, error: binError } = await supabase.from('bins').select('barangay').eq('id', binKey).single();
            if (binError) console.error("Unable to load reported bin location:", binError);
            const binBarangay = binData ? binData.barangay : "Global";

            // 1. Submit detailed report[cite: 8]
            const { error: reportError } = await supabase.from('reports').insert({
                bin_id: binKey,
                issue: issueText,
                timestamp: new Date().toISOString(),
                collector: user.email
            });
            if (reportError) throw reportError;
            await loadIncidentReports();

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

            const { error: citizenNotificationError } = await supabase.from('notifications').insert({
                title: "Bin Management Alert",
                message: customMessage,
                barangay: binBarangay, 
                type: notifType,
                status: "unread",
                created_at: new Date().toISOString()
            });
            if (citizenNotificationError) {
                console.error("Bin report filed, but citizen notification could not be created:", citizenNotificationError);
                await writeLog("Bin Reported", `Collection report filed for ${binKey}; citizen notification failed for Brgy. ${binBarangay}.`, "logs");
                alert(`Report filed successfully, but the citizen notification could not be sent.`);
                closeDetailView();
                return;
            }

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

    // Hide the Bin Details page
    binDetailView.style.display = 'none';
    // Return to the Bin Selection page
    binSelectionView.style.display = 'block';
    // Restore Incident Reports
    incidentReportsSection.style.display = 'block';
    // Reset form inputs
    document.querySelectorAll('input[name="issue"]').forEach(el => el.checked = false);

    const otherInput = document.getElementById('otherIssueInput');
    if (otherInput) otherInput.value = "";
}

    backBtn.addEventListener('click', closeDetailView);
});