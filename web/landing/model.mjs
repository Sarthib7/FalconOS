import scenarios from './scenarios.json' with { type: 'json' };
export { scenarios };
export const buckets = [['reserveUnits','Spending reserve','var(--fg)','Outside authority'],['undelegatedUnits','Undelegated cash','var(--cash)','Outside authority'],['idleUnits','Delegated idle','var(--accent)','Available to the agent'],['positionUnits','Lending position','var(--blue)','Simulated position']];
export function amount(units) {
  const value = BigInt(units);
  const whole = (value / 1000000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (value % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
  return whole + (fraction ? '.' + fraction : '');
}
export const usdc = units => amount(units) + ' USDC';
export function graphNode(scenario, id) { return scenario.entry.graph.nodes.find(node => node.id === id); }
export function traceData(scenario) {
  return { schema: 'falcon.landing-scenario/v1', mode: 'simulation', source: 'synthetic', scenario: scenario.id, syntheticTime: true,
    notice: 'Independent illustrative snapshot. No wallet, market provider, or live agent is connected. This is not a persisted treasury run.', before: scenario.before, record: scenario.entry };
}
export function traceJson(scenario) { return JSON.stringify(traceData(scenario), null, 2); }
export const presentation={
 supply:{balance:'500 USDC supplied',decision:'Ready within the mandate',outcome:'Moved into the position',rule:'Within your limits',ruleValue:'500 / 500 USDC cap',ruleCopy:'Evidence meets the floor. The budget fits the cap.',route:'Idle → position'},
 hold:{balance:'Position held',decision:'Position already funded',outcome:'Position unchanged',rule:'Keep the position',ruleValue:'Liquidity above the floor',ruleCopy:'The position is funded and evidence still meets the rules.',route:'Position unchanged'},
 redeem:{balance:'500 USDC redeemed',decision:'Full redemption permitted',outcome:'Returned to delegated idle',rule:'Below your floor',ruleValue:'600 < 1,000 USDC floor',ruleCopy:'Liquidity covers the 500 USDC position, so full redemption is possible.',route:'Position → idle'},
 blocked:{balance:'Exit blocked; position preserved',decision:'Full exit liquidity is too low',outcome:'Position preserved',rule:'Exit cannot settle',ruleValue:'100 < 500 USDC position',ruleCopy:'The exit needs enough liquidity for the whole position.',route:'No movement'},
 stale:{balance:'No movement; evidence is stale',decision:'Fresh evidence required',outcome:'Balances unchanged',rule:'Evidence has expired',ruleValue:'120 > 60 seconds',ruleCopy:'Later liquidity and position checks are skipped.',route:'No movement'}
};

export function inspectScenario(s, selectedNode='mandate', selectedCheck=null){const g=s.entry.graph,d=s.entry.decision;let title,kind,copy,rows,links=[],evidence=[];
 if(selectedCheck){const check=d.checks.find(c=>c.id===selectedCheck);kind='Rule check / '+check.status.replace('_',' ');title=check.label;copy=check.detail;rows=[['Result',check.status.replace('_',' ')],['Source','Synthetic snapshot'],['Rule policy',d.policyVersion]];evidence=check.evidenceNodeIds;links=evidence.map(id=>'Evidence: '+g.nodes.find(n=>n.id===id).label);}
 else if(selectedNode==='decision'){kind='Rule decision / '+d.status.replace('_',' ');title=d.action==='HOLD'?'Why the agent holds.':d.action==='SUPPLY'?'Why supply is allowed.':'Why redemption is requested.';copy=d.reasons.join(' ');rows=[['Decision',d.action],['Status',d.status.replace('_',' ')],['Requested amount',usdc(d.amountUnits)],['Rule policy',d.policyVersion]];evidence=d.evidenceNodeIds;links=evidence.map(id=>'Uses '+g.nodes.find(n=>n.id===id).label);}
 else if(selectedNode==='outcome'){const o=s.entry.outcome;kind='Result / Simulation';title=presentation[s.id].outcome+'.';copy=s.id==='blocked'?'The request was blocked. All 500 synthetic USDC remain in the position.':s.id==='stale'?'Stale evidence permits no movement. The existing position stays unchanged.':s.id==='redeem'?'Redemption returns the position to delegated idle. The owner reserve and undelegated cash do not change.':s.id==='hold'?'The position remains funded. This decision moves no synthetic USDC.':'The entire 500 USDC budget moves into the simulated position. The owner reserve and undelegated cash do not change.';rows=[['Amount moved',usdc(o.amountUnits)],['Delegated idle',usdc(s.entry.balances.idleUnits)],['Position',usdc(s.entry.balances.positionUnits)],['Fees / interest','0 / 0 USDC']];links=['Rule decision → resulting balances'];}
 else {const node=g.nodes.find(n=>n.id===selectedNode);kind='Selected / '+node.label;
 const detail={
 mandate:{title:'You set the boundary.',copy:'The agent can use up to 500 synthetic USDC. Your spending reserve and undelegated cash are excluded.',rows:[['Investment cap','500 USDC'],['Liquidity floor','1,000 USDC'],['Evidence age limit','60 seconds'],['Authority','Active in this example']]},
 reserve:{title:'Set aside for spending.',copy:'This 200 USDC stays outside agent authority. Supply and redemption do not change it in the simulation.',rows:[['Before',usdc(s.before.reserveUnits)],['After',usdc(s.entry.balances.reserveUnits)],['Agent access','Excluded']]},
 undelegated:{title:'Still yours to direct.',copy:'This cash is not part of the delegated budget. The agent cannot supply it under the example mandate.',rows:[['Before',usdc(s.before.undelegatedUnits)],['After',usdc(s.entry.balances.undelegatedUnits)],['Agent access','Excluded']]},
 account:{title:'The delegated budget.',copy:'Idle USDC can move into a position only when the evidence and owner rules permit it.',rows:[['Idle before',usdc(s.before.idleUnits)],['Idle after',usdc(s.entry.balances.idleUnits)],['Investment cap','500 USDC']]},
 position:{title:'The position at decision time.',copy:'The position belongs to the investment account. Its next action depends on synthetic liquidity evidence.',rows:[['Before',usdc(s.before.positionUnits)],['After',usdc(s.entry.balances.positionUnits)],['Interest','0 USDC'],['Mode','Simulation']]},
 observation:{title:s.id==='stale'?'Too old to act on.':'The evidence behind the move.',copy:'A synthetic liquidity observation, recorded for this example. No market provider was contacted.',rows:[['Available liquidity',s.liquidity==='2000'?'2,000 USDC':s.liquidity+' USDC'],['Age at decision',s.age+' seconds'],['Maximum age','60 seconds'],['Source','Synthetic']]}
 }[selectedNode];title=detail.title;copy=detail.copy;rows=detail.rows;links=g.edges.filter(e=>e.source===selectedNode||e.target===selectedNode).map(e=>g.nodes.find(n=>n.id===e.source).label+' '+e.relation.replace('_',' ')+' '+g.nodes.find(n=>n.id===e.target).label);}
 return {kind,title,copy,rows,links,evidence};
}
