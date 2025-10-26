// Admin Controller for IoT Charging Device Management

export const adminDashboard = (req, res) => {
  res.render("admin-dashboard");
};

export const chargingStation = (req, res) => {
  res.render("charging-station");
};

// API endpoint to simulate student data fetch (will connect to Firebase later)
export const getStudentInfo = async (req, res) => {
  const { studentId } = req.params;
  
  // Mock data - replace with Firebase later
  const mockStudentData = {
    name: "Lans Lorence Hernandez",
    studentId: studentId,
    points: 150,
    lastUsed: "2025-10-20"
  };
  
  res.json(mockStudentData);
};

// API endpoint to process charging session (will connect to Firebase later)
export const processCharging = async (req, res) => {
  const { studentId, pointsToSpend, socketNumber } = req.body;
  
  // Mock response - replace with actual Firebase deduction later
  const response = {
    success: true,
    message: "Charging session started",
    remainingPoints: 150 - pointsToSpend,
    socket: socketNumber,
    duration: pointsToSpend * 2 // 2 minutes per point (example)
  };
  
  res.json(response);
};
