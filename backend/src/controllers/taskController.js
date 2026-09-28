const TaskTicket = require('../models/TaskTicket');

const getTaskTickets = async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    
    const tickets = await TaskTicket.find(query).sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      count: tickets.length,
      data: tickets
    });
  } catch (error) {
    console.error('Error fetching task tickets:', error.message);
    res.status(500).json({ success: false, message: 'Server error fetching tasks' });
  }
};

const updateTaskStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, assignedStaff } = req.body;

    const updateFields = {};
    if (status) updateFields.status = status;
    if (assignedStaff) updateFields.assignedStaff = assignedStaff;

    const updatedTicket = await TaskTicket.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!updatedTicket) {
      return res.status(404).json({ success: false, message: 'Task ticket not found' });
    }

    console.log(`🔄 Task ticket ${id} updated to status: "${status || 'unchanged'}"`);

    res.status(200).json({
      success: true,
      data: updatedTicket
    });
  } catch (error) {
    console.error('Error updating task ticket:', error.message);
    res.status(500).json({ success: false, message: 'Server error updating task' });
  }
};

module.exports = {
  getTaskTickets,
  updateTaskStatus
};
