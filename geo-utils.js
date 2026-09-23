// Geo-Location & Complaint Clustering Utilities for Civic Portal

const PROXIMITY_THRESHOLD_METERS = 100; // 100 meters radius for same civic issue

/**
 * Calculates the great-circle distance between two points on the Earth's surface
 * using the Haversine formula (result in meters).
 */
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) {
    return Infinity;
  }
  const R = 6371e3; // Earth radius in meters
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Parses latitude and longitude numbers from a string like "13.0827, 80.2707"
 */
function parseCoords(locStr) {
  if (!locStr || typeof locStr !== 'string') return null;
  const parts = locStr.split(',');
  if (parts.length !== 2) return null;
  const lat = parseFloat(parts[0].trim());
  const lon = parseFloat(parts[1].trim());
  if (isNaN(lat) || isNaN(lon)) return null;
  return { lat, lon };
}

/**
 * Retrieves all stored issues from localStorage
 */
function getAllIssues() {
  const issues = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("REP")) {
      try {
        const issue = JSON.parse(localStorage.getItem(key));
        if (issue && issue.id) {
          issues.push(issue);
        }
      } catch (err) {
        console.error("Error reading issue " + key, err);
      }
    }
  }
  return issues;
}

/**
 * Finds existing issues within the proximity threshold for the same category.
 * Can filter by active issues (non-resolved) or include all.
 */
function findNearbyIssues(category, lat, lon, activeOnly = true, thresholdMeters = PROXIMITY_THRESHOLD_METERS) {
  if (lat == null || lon == null) return [];
  const all = getAllIssues();
  const nearby = [];

  for (const issue of all) {
    if (category && issue.category && issue.category.toLowerCase() !== category.toLowerCase()) {
      continue;
    }
    if (activeOnly && issue.status === "Resolved") {
      continue;
    }

    const coords = parseCoords(issue.location);
    if (!coords) continue;

    const dist = getDistanceMeters(lat, lon, coords.lat, coords.lon);
    if (dist <= thresholdMeters) {
      nearby.push({
        issue,
        distanceMeters: Math.round(dist)
      });
    }
  }

  // Sort by closest distance first
  nearby.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return nearby;
}

/**
 * Groups/Clusters all stored issues into consolidated complaints based on category and GPS distance.
 */
function clusterAllIssues(thresholdMeters = PROXIMITY_THRESHOLD_METERS) {
  const allIssues = getAllIssues();
  // Sort chronologically so earliest report becomes the primary anchor
  allIssues.sort((a, b) => {
    const timeA = new Date(a.date).getTime() || 0;
    const timeB = new Date(b.date).getTime() || 0;
    return timeA - timeB;
  });

  const clusters = [];

  for (const issue of allIssues) {
    const coords = parseCoords(issue.location);
    let matchedCluster = null;

    if (coords) {
      for (const cluster of clusters) {
        if (cluster.category.toLowerCase() === (issue.category || "").toLowerCase()) {
          // Check distance to cluster centroid or anchor
          const dist = getDistanceMeters(coords.lat, coords.lon, cluster.centroid.lat, cluster.centroid.lon);
          if (dist <= thresholdMeters) {
            matchedCluster = cluster;
            break;
          }
        }
      }
    } else if (issue.address) {
      // Fallback: match by exact address text if GPS coords missing
      for (const cluster of clusters) {
        if (cluster.category.toLowerCase() === (issue.category || "").toLowerCase() &&
            cluster.address && cluster.address.trim().toLowerCase() === issue.address.trim().toLowerCase()) {
          matchedCluster = cluster;
          break;
        }
      }
    }

    if (matchedCluster) {
      matchedCluster.reportsCount += 1;
      matchedCluster.ids.push(issue.id);
      matchedCluster.issues.push(issue);

      if (issue.beforePhoto && !matchedCluster.photos.includes(issue.beforePhoto)) {
        matchedCluster.photos.push(issue.beforePhoto);
      }
      if (issue.location && !matchedCluster.locations.includes(issue.location)) {
        matchedCluster.locations.push(issue.location);
      }
      if (issue.description && !matchedCluster.descriptions.includes(issue.description)) {
        matchedCluster.descriptions.push(issue.description);
      }
      // If any report is resolved, keep after photo or status sync
      if (issue.afterPhoto && !matchedCluster.afterPhoto) {
        matchedCluster.afterPhoto = issue.afterPhoto;
      }
      // Update last reported date
      matchedCluster.lastReportedDate = issue.date || matchedCluster.lastReportedDate;
    } else {
      const newCluster = {
        clusterId: "CLS-" + issue.id,
        primaryId: issue.id,
        category: issue.category,
        description: issue.description,
        descriptions: issue.description ? [issue.description] : [],
        address: issue.address || "Address not available",
        centroid: coords || { lat: 0, lon: 0 },
        locations: issue.location ? [issue.location] : [],
        status: issue.status || "Pending",
        reportsCount: 1,
        ids: [issue.id],
        issues: [issue],
        photos: issue.beforePhoto ? [issue.beforePhoto] : [],
        afterPhoto: issue.afterPhoto || null,
        createdDate: issue.date,
        lastReportedDate: issue.date
      };
      clusters.push(newCluster);
    }
  }

  // Calculate priority rating based on number of citizen reports
  clusters.forEach(c => {
    if (c.reportsCount >= 4) {
      c.priority = "CRITICAL";
      c.priorityLabel = "🔥 Critical Priority (" + c.reportsCount + " Citizens Reported)";
      c.priorityBadgeClass = "badge-critical";
    } else if (c.reportsCount >= 2) {
      c.priority = "HIGH";
      c.priorityLabel = "⚡ High Priority (" + c.reportsCount + " Citizens Reported)";
      c.priorityBadgeClass = "badge-high";
    } else {
      c.priority = "NORMAL";
      c.priorityLabel = "Standard Priority (1 Report)";
      c.priorityBadgeClass = "badge-normal";
    }
  });

  return clusters;
}

/**
 * Updates status across all linked reports in a cluster
 */
function updateClusterStatus(targetId, newStatus) {
  const clusters = clusterAllIssues();
  const cluster = clusters.find(c => c.ids.includes(targetId) || c.clusterId === targetId);

  if (cluster) {
    cluster.ids.forEach(id => {
      try {
        const item = JSON.parse(localStorage.getItem(id));
        if (item) {
          item.status = newStatus;
          item.clusterId = cluster.clusterId;
          localStorage.setItem(id, JSON.stringify(item));
        }
      } catch (e) {
        console.error("Failed to update status for " + id, e);
      }
    });
    return cluster;
  } else {
    // If not in a cluster, update individual
    try {
      const item = JSON.parse(localStorage.getItem(targetId));
      if (item) {
        item.status = newStatus;
        localStorage.setItem(targetId, JSON.stringify(item));
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  }
}

/**
 * Updates resolution afterPhoto across all linked reports in a cluster and marks Resolved
 */
function updateClusterAfterPhoto(targetId, base64AfterPhoto) {
  const clusters = clusterAllIssues();
  const cluster = clusters.find(c => c.ids.includes(targetId) || c.clusterId === targetId);

  if (cluster) {
    cluster.ids.forEach(id => {
      try {
        const item = JSON.parse(localStorage.getItem(id));
        if (item) {
          item.afterPhoto = base64AfterPhoto;
          item.status = "Resolved";
          item.clusterId = cluster.clusterId;
          localStorage.setItem(id, JSON.stringify(item));
        }
      } catch (e) {
        console.error("Failed to save afterPhoto for " + id, e);
      }
    });
    return cluster;
  } else {
    try {
      const item = JSON.parse(localStorage.getItem(targetId));
      if (item) {
        item.afterPhoto = base64AfterPhoto;
        item.status = "Resolved";
        localStorage.setItem(targetId, JSON.stringify(item));
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  }
}

/**
 * Gets cluster information for a specific report ID (useful for track-issue.html)
 */
function getClusterForReportId(reportId) {
  const clusters = clusterAllIssues();
  return clusters.find(c => c.ids.includes(reportId)) || null;
}
