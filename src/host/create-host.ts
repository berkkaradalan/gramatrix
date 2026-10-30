import { AgentService } from './agent/agent-service'
import { ChannelService } from './channels/channel-service'
import type { HostContext } from './context'
import { ProviderService } from './providers/provider-service'
import { createModelResolver } from './providers/resolve-model'
import { RpcRouter } from './rpc-router'
import { JobService } from './scheduler/job-service'
import { ChatService } from './services/chats'
import { ProjectService } from './services/projects'
import { SettingsService } from './services/settings'
import { UsageService } from './services/usage'

export interface Services {
  settings: SettingsService
  projects: ProjectService
  chats: ChatService
  providers: ProviderService
  agent: AgentService
  jobs: JobService
  channels: ChannelService
  usage: UsageService
}

export interface Host {
  router: RpcRouter
  services: Services
  /** Starts background work such as schedules and channel connections. */
  start(): void
  stop(): Promise<void>
}

/** Wires every service together. It has no Electron dependency, so tests can use it directly. */
export function createHost(context: HostContext): Host {
  const router = new RpcRouter()
  const settings = new SettingsService(context)
  const projects = new ProjectService(context)
  const chats = new ChatService(context)
  const resolveModel = createModelResolver(context)
  const providers = new ProviderService(context, resolveModel)
  const usage = new UsageService(context, { findModel: (ref) => providers.findModel(ref) })
  const agent = new AgentService(context, { chats, projects, resolveModel, usage })
  const jobs = new JobService(context, { chats, runner: agent })
  const channels = new ChannelService(context, { chats, settings, runner: agent })

  // Work must not outlive the chat or project it belongs to.
  chats.onRemove((chatId) => agent.cancel(chatId))
  projects.onRemove((projectId) => {
    for (const chat of chats.list(projectId)) agent.cancel(chat.id)
    jobs.handleProjectRemoved(projectId)
  })

  const services: Services = {
    settings,
    projects,
    chats,
    providers,
    agent,
    jobs,
    channels,
    usage
  }
  for (const service of Object.values(services)) service.register(router)

  return {
    router,
    services,
    start: () => {
      jobs.start()
      channels.start()
    },
    stop: async () => {
      await Promise.all([agent.stop(), jobs.stop(), channels.stop()])
    }
  }
}
