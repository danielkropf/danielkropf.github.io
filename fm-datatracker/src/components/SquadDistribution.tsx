import type { CSSProperties } from 'react'
import type { PlanningDistributionGroup } from '../lib/planningDistribution'

type Props = {
  groups: PlanningDistributionGroup[]
  unassigned: number
  total: number
}

const squadTones = ['#b9f35b', '#83d77b', '#5fbea0', '#65a9cf', '#9b8fe5', '#c28bd5']
const transferTones = { loan: '#efc657', sale: '#e78373', unassigned: '#61766a' }

export function SquadDistribution({ groups, unassigned, total }: Props) {
  const visibleGroups = groups.filter(group => group.count > 0)
  const segments = [
    ...visibleGroups.map((group, index) => ({
      id: group.id,
      name: group.name,
      count: group.count,
      color: group.kind === 'loan'
        ? transferTones.loan
        : group.kind === 'sale'
          ? transferTones.sale
          : squadTones[index % squadTones.length],
    })),
    ...(unassigned > 0 ? [{ id: 'unassigned', name: 'Sem destino', count: unassigned, color: transferTones.unassigned }] : []),
  ]

  if (!total) return null

  return <div className="squad-distribution-v2">
    <div className="squad-distribution-stack" role="img" aria-label={`Distribuição de ${total} jogadores ativos`}>
      {segments.map(segment => {
        const percentage = segment.count / total * 100
        const style = {
          width: `${percentage}%`,
          '--distribution-color': segment.color,
        } as CSSProperties
        return <span
          className={`squad-distribution-segment distribution-${segment.id}`}
          style={style}
          title={`${segment.name}: ${segment.count} jogadores (${Math.round(percentage)}%)`}
          aria-label={`${segment.name}: ${segment.count} jogadores`}
          key={segment.id}
        />
      })}
    </div>
    <div className="squad-distribution-legend">
      {segments.map(segment => <div key={segment.id}>
        <i style={{ '--distribution-color': segment.color } as CSSProperties}/>
        <span>{segment.name}</span>
        <strong>{segment.count}</strong>
      </div>)}
    </div>
  </div>
}
