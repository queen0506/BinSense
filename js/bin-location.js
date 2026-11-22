export function getValidBinPosition(bin) {
    if (bin.lat == null || bin.lng == null || String(bin.lat).trim() === '' || String(bin.lng).trim() === '') return null;

    const lat = Number(bin.lat);
    const lng = Number(bin.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

    return { lat, lng };
}

export function getBinLocationLabel(bin) {
    const position = getValidBinPosition(bin);
    if (!position) return 'Location not assigned';

    const parts = [bin.street, bin.barangay]
        .map(value => String(value ?? '').trim())
        .filter(value => value && !/^(unassigned|unknown|n\/a|not specified|global)$/i.test(value));
    return parts.join(', ') || `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`;
}
