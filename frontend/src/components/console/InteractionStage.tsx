import { useState } from 'react';
import type { SurveyRecord } from '../../../../shared/guided';
import type { AppConfig, ProjectDetail } from '../../../../shared/types';
import type { Inspection } from '../../lib/graph';
import { EmptyPanel, Tabs } from '../ui';
import { ChatPanel } from './ChatPanel';
import { SurveyPanel } from './SurveyPanel';

type InteractionTab = 'report' | 'agent' | 'survey';

export function InteractionStage({
  project,
  config,
  onSurvey,
  onInspect,
}: {
  project: ProjectDetail;
  config: AppConfig | null;
  onSurvey: (record: SurveyRecord) => void;
  onInspect: (selection: Inspection) => void;
}) {
  const [tab, setTab] = useState<InteractionTab>('report');
  const [agentId, setAgentId] = useState(project.agents[0]?.id ?? '');
  const configured = Boolean(config?.provider.configured && config.capabilities.modelAssisted);
  if (project.status !== 'completed' || !project.report)
    return (
      <div className="stage-content">
        <EmptyPanel title="Interaction awaits a completed report">
          Finish report generation before asking questions or starting proxy surveys. Existing
          partial text remains readable in Report.
        </EmptyPanel>
      </div>
    );
  return (
    <div className="stage-content interaction-stage view-stack">
      <div>
        <span className="eyebrow">05 / INTERACTION</span>
        <h2>Question the recorded scenario</h2>
        <p className="stage-intro">
          The report stays alongside your inquiry. Check every answer against its source and
          simulated-memory references.
        </p>
      </div>
      <Tabs
        id="interaction"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'report', label: 'Report chat' },
          { id: 'agent', label: 'Any fictional agent' },
          { id: 'survey', label: 'Survey', count: project.console?.surveys.length },
        ]}
      />
      <div id="interaction-panel" role="tabpanel" aria-labelledby={`interaction-tab-${tab}`}>
        {tab === 'report' && (
          <ChatPanel
            key="report"
            project={project}
            target="report"
            modelConfigured={configured}
            onInspect={onInspect}
          />
        )}
        {tab === 'agent' && (
          <div className="view-stack">
            <div className="field">
              <label htmlFor="interaction-agent">Fictional agent context</label>
              <select
                id="interaction-agent"
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
              >
                {!project.agents.length && <option value="">No agents recorded</option>}
                {project.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} · {agent.role}
                  </option>
                ))}
              </select>
            </div>
            {agentId ? (
              <ChatPanel
                key={agentId}
                project={project}
                target={agentId}
                modelConfigured={configured}
                onInspect={onInspect}
              />
            ) : (
              <EmptyPanel title="No fictional agent records">
                No persona context can be selected in this historical record.
              </EmptyPanel>
            )}
          </div>
        )}
        {tab === 'survey' && (
          <SurveyPanel
            project={project}
            config={config}
            onRecord={onSurvey}
            onInspect={onInspect}
          />
        )}
      </div>
    </div>
  );
}
