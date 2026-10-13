const TaskTicket = require('../models/TaskTicket');
const { annotateTickets, closeReview, requiresReceptionReview } = require('../services/taskReviewService');
const statuses = ['Pending', 'In Progress', 'Resolved', 'Escalated'];
const getTaskTickets = async (req, res) => {
  try {
    const { status } = req.query;
    if (status !== undefined && !statuses.includes(status)) return res.status(400).json({ success: false, message: 'Invalid task status' });
    const tickets = await TaskTicket.find(status ? { status } : {}).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: tickets.length, data: await annotateTickets(tickets) });
  } catch (error) {
    console.error('Error fetching tasks:', error.name);
    return res.status(500).json({ success: false, message: 'Server error fetching tasks' });
  }
};
const updateTaskStatus = async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-f\d]{24}$/i.test(id)) return res.status(400).json({ success: false, message: 'Invalid task ID' });
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['status', 'assignedStaff'].includes(key))) return res.status(400).json({ success: false, message: 'Only status and assignedStaff can be updated' });
    const updateFields = {};
    if (Object.hasOwn(body, 'status')) {
      if (!statuses.includes(body.status)) return res.status(400).json({ success: false, message: 'Invalid task status'});
      updateFields.status = body.status;
    }
    if (Object.hasOwn(body, 'assignedStaff')) {
      if (typeof body.assignedStaff !== 'string' || body.assignedStaff.trim().length > 100) return res.status(400).json({ success: false, message: 'Staff name must be at most 100 characters' });
      updateFields.assignedStaff = body.assignedStaff.trim() || null;
    }
    if (!Object.keys(updateFields).length) return res.status(400).json({ success: false, message: 'Provide a status or assignment' });
    if (updateFields.status === 'Resolved') {
      // HANDOFF can use any department: enforce review semantics at the API boundary.
      const ticket = await TaskTicket.findById(id);
      if (!ticket) return res.status(404).json({ success: false, message: 'Task ticket not found' });
      if (await requiresReceptionReview(ticket)) return res.status(409).json({ success: false, message: 'Reply to the guest, then use Close review.' });
      const result = await require('../services/taskCompletionService').completeTask(id);
      return res.status(result.code).json(result);
    }
    const updatedTicket = await TaskTicket.findByIdAndUpdate(id, { $set: updateFields }, { returnDocument: 'after', runValidators: true });
    if (!updatedTicket) return res.status(404).json({ success: false, message: 'Task ticket not found' });
    return res.status(200).json({ success: true, data: (await annotateTickets([updatedTicket]))[0] });
  } catch (error) {
    console.error('Error updating task:', error.name);
    return res.status(500).json({ success: false, message: 'Server error updating task' });
  }
};
// Closing reception review deliberately has no guest notification or booking action.
const closeTaskReview = async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid task ID' });
    if (req.body && Object.keys(req.body).length) return res.status(400).json({ success: false, message: 'No booking or status changes may accompany review closure.' });
    const result = await closeReview(req.params.id);
    return res.status(result.code).json(result);
  } catch (error) {
    console.error('Review closure failed:', error.name);
    return res.status(500).json({ success: false, message: 'Review closure could not be confirmed. Refresh before retrying.' });
  }
};
module.exports = { getTaskTickets, updateTaskStatus, closeTaskReview };
