const express = require('express');
const router = express.Router();
const { getTaskTickets, updateTaskStatus, closeTaskReview } = require('../controllers/taskController');

router.get('/', getTaskTickets);
router.patch('/:id', updateTaskStatus);
router.post('/:id/close-review', closeTaskReview);

module.exports = router;
