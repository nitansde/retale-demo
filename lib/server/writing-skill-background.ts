import { scheduleAfterResponse } from '@/lib/server/workspace-background'
import { WritingSkillDistillationAgent } from '@/lib/server/writing-skill-distillation-agent'

const scheduledJobs = new Set<string>()

export function scheduleWritingSkillDistillationJob(jobId: string) {
  if (scheduledJobs.has(jobId)) return
  scheduledJobs.add(jobId)
  scheduleAfterResponse(async () => {
    try {
      await new WritingSkillDistillationAgent().run(jobId)
    } catch (error) {
      console.error('Writing skill distillation background job failed:', error)
    } finally {
      scheduledJobs.delete(jobId)
    }
  })
}
