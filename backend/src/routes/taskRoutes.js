const express = require('express');
const router = express.Router();
const { getTaskTickets, updateTaskStatus } = require('../controllers/taskController');

router.get('/', getTaskTickets);
router.patch('/:id', updateTaskStatus);

module.exports = router;
