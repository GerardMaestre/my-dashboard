const logger = require('../utils/logger');
const taskQueue = require('./queue');

class Scheduler {
    constructor() {
        this.tasks = new Map();
        this.intervals = new Map();
    }

    /**
     * @param {string} id - Unique ID for the scheduled task
     * @param {string} cron - For now, just a semantic name or simple interval (e.g. 'hourly', 'daily')
     * @param {number} intervalMs - Frequency in ms
     * @param {Function} taskFn - The logic to enqueue
     */
    schedule(id, cron, intervalMs, taskFn) {
        if (this.intervals.has(id)) {
            clearInterval(this.intervals.get(id));
        }

        const runTask = () => {
            logger.info(`[Scheduler] Enqueuing scheduled task: ${id} (${cron})`);
            taskQueue.enqueue(id, taskFn, { scheduled: true, type: cron });
        };

        // Run once initially (optional)
        // runTask();

        const interval = setInterval(runTask, intervalMs);
        this.intervals.set(id, interval);
        this.tasks.set(id, { cron, intervalMs });
        
        logger.info(`[Scheduler] Task ${id} scheduled: every ${intervalMs / 1000 / 60} mins (${cron})`);
    }

    stop(id) {
        if (this.intervals.has(id)) {
            clearInterval(this.intervals.get(id));
            this.intervals.delete(id);
            this.tasks.delete(id);
            logger.info(`[Scheduler] Task ${id} stopped.`);
        }
    }

    list() {
        return Array.from(this.tasks.entries()).map(([id, data]) => ({ id, ...data }));
    }
}

const scheduler = new Scheduler();
module.exports = scheduler;
