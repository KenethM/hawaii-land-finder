import type { Buildable } from './buildable'
import { useState } from 'react'
import type { Frontage } from './frontage'
import { lotLink, shareUrl } from './share'
import { floodText, lavaText, powerText, rainText, roadText, sqft, STATUS, usd, type Lot, type ZoneRule } from './lot'

interface Props {
  lot: Lot
  rule: ZoneRule | undefined
  buildable: Buildable | null
  road: Frontage | null
  checkedOn: string
  onClose: () => void
  onPlan: () => void
}

function Row({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd>
        {value}
        {note && <p className="note">{note}</p>}
      </dd>
    </div>
  )
}

export default function LotPanel({ lot, rule, buildable, road: roadHit, checkedOn, onClose, onPlan }: Props) {
  const status = STATUS[lot.status]
  const lava = lavaText(lot.lava)
  const power = powerText(lot)
  // Same road the setbacks use (the one the lot's front edge faces); fall back to the build-time match
  const roadName = roadHit ? roadHit.name : lot.road
  const roadM = roadHit ? Math.round(roadHit.distM) : lot.road_m
  const road = roadHit ? roadText(roadHit.owner, roadHit.maint) : roadText(lot.road_owner, lot.road_maint)
  const setback = buildable?.setback
  const corner = roadHit?.alsoFronts.length ? roadHit.alsoFronts : null
  const [linkMsg, setLinkMsg] = useState<string | null>(null)
  const copyLink = async () => {
    const how = await shareUrl(lotLink(lot.tmk), `Lot TMK ${lot.tmk}`)
    setLinkMsg(how === 'copied' ? 'Link copied' : how === 'shared' ? 'Shared' : 'Couldn’t copy')
    setTimeout(() => setLinkMsg(null), 2500)
  }

  return (
    <aside className="panel" aria-label={`Lot report for TMK ${lot.tmk}`}>
      <div className="grabber" aria-hidden="true" />
      <header className="panel-head">
        <div>
          <p className="eyebrow">TMK {lot.tmk}</p>
          <h2>
            {lot.acres} acres{lot.zone && <span className="muted"> · {lot.zone}</span>}
          </h2>
          <p className="status-chip" style={{ '--chip': status.color } as React.CSSProperties}>
            <span aria-hidden="true">{status.icon}</span> {status.label}
            {lot.sample && <strong className="sample">SAMPLE DATA</strong>}
          </p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close lot report">
          ✕
        </button>
      </header>

      <div className="panel-actions">
        <button className="plan-btn" onClick={onPlan}>
          Plan this lot
          <span className="muted">Sketch a home, tank and notes on the lot</span>
        </button>
        <button className="link-btn" onClick={copyLink} aria-live="polite">
          {linkMsg ?? '🔗 Copy link'}
        </button>
      </div>

      {lot.sample && (
        <p className="callout warn">
          This listing status is made-up sample data for the prototype. Real listings need an MLS feed through a
          licensed broker.
        </p>
      )}

      <section>
        <h3>The basics</h3>
        <dl>
          <Row label="Size" value={`${lot.acres} acres · about ${lot.w_ft} × ${lot.d_ft} ft`} note="Parcel lines are approximate, not survey-grade." />
          <Row label="Zoning" value={lot.zone ?? 'Unknown'} />
          <Row label="Assessed land value" value={usd(lot.land_val)} />
          <Row label="Assessed building value" value={lot.bldg_val > 0 ? usd(lot.bldg_val) : 'None (vacant)'} />
          {lot.qpub && (
            <Row
              label="Sales history & owner"
              value={
                <a href={lot.qpub} target="_blank" rel="noreferrer">
                  County property record ↗
                </a>
              }
            />
          )}
        </dl>
      </section>

      <section>
        <h3>Hazards</h3>
        <dl>
          <Row label="Lava flow zone" value={lava.title} note={<>{lava.body}{lava.insurance && <strong className="block">{lava.insurance}</strong>}</>} />
          <Row label="Flood" value={floodText(lot.flood, lot.sfha)} />
          <Row label="Tsunami evacuation zone" value={lot.tsunami ? 'Yes' : 'No'} />
          <Row label="Wildfire risk (community)" value={lot.fire ? `${lot.fire}${lot.fire_area ? ` · ${lot.fire_area}` : ''}` : 'Not rated'} />
          {lot.sma && <Row label="Special Management Area" value="Yes: extra county permits for most building." />}
        </dl>
      </section>

      <section>
        <h3>Land & climate</h3>
        <dl>
          <Row label="Rainfall" value={rainText(lot.rain_in)} note="Estimated between rainfall contour lines (UH Rainfall Atlas)." />
          <Row label="Elevation" value={lot.elev_ft ? `About ${lot.elev_ft.toLocaleString()} ft` : 'Unknown'} />
          <Row
            label="Slope"
            value={lot.slope_deg != null ? `About ${lot.slope_deg}°${lot.slope_deg < 5 ? ' (gentle)' : lot.slope_deg < 15 ? ' (moderate)' : ' (steep)'}` : 'Not yet available'}
            note={lot.slope_deg == null ? 'Lidar-based slope is coming in a later version.' : undefined}
          />
        </dl>
      </section>

      <section>
        <h3>Utilities & access</h3>
        <dl>
          <Row
            label="County water"
            value="Unknown"
            note="Service maps aren't loaded yet. Many lots in this area have no county water and rely on rainwater catchment (tank, gutters, filtration/UV). Budget for it."
          />
          <Row label="Power" value={power.label} note={power.detail} />
          <Row
            label="Road access"
            value={
              <>
                {road.warn && <span aria-hidden="true">⚠ </span>}
                {road.label}
                {roadName && <span className="muted"> · {roadName}{roadM >= 15 ? ` (${roadM} m away)` : ''}</span>}
              </>
            }
            note={<>{road.note} This is the road the lot’s front faces; corner lots may also touch another road.</>}
          />
          <Row
            label="Wastewater"
            value="Septic / approved individual system needed"
            note={
              <>
                Hawaii is phasing out cesspools (Act 125, 2017; conversion by 2050), so a new home generally needs an
                approved individual wastewater system. This is a real cost item.
                {lot.septic_soil && <span className="block">Soil rating for septic (USDA, from the state cesspool tool): <strong>{lot.septic_soil}</strong>.</span>}
              </>
            }
          />
        </dl>
      </section>

      <section>
        <h3>What could I build?</h3>
        {buildable && setback ? (
          <>
            {!setback.confirmed && (
              <p className="callout warn">
                <strong>Confirm with Planning.</strong> Setbacks come from the county’s 2019 setback brochure and haven’t
                been re-confirmed with Hawaiʻi County Planning ((808) 961-8288).
              </p>
            )}
            <dl>
              <Row
                label="Setbacks"
                value={`${setback.front_rear_ft} ft front & rear · ${setback.side_ft} ft sides`}
                note={`${setback.label}. ${
                  corner
                    ? `Corner lot: front setbacks applied on both road sides (${[roadName, ...corner.map((c) => c.name)].filter(Boolean).join(' and ')}), the most cautious reading. Planning may decide differently; you can choose in Plan this lot.`
                    : buildable.usesFrontage
                      ? `Front is the side facing ${roadName ?? 'the road'}.`
                      : 'Assumes the short ends of the lot are the front and rear.'
                } Sheds, water tanks and carports must meet the same setbacks.`}
              />
              <Row
                label="Buildable area"
                value={buildable.envelope ? `About ${sqft(buildable.envelopeM2)} sq ft (${Math.round((buildable.envelopeM2 / buildable.lotM2) * 100)}% of the lot)` : 'None: the setbacks cover the whole lot'}
                note={buildable.envelope ? 'Purple dashed outline on the map.' : 'Ask Planning about a variance or how yards apply to this lot shape.'}
              />
              <Row
                label="Max footprint"
                value={buildable.maxFootprintM2 != null ? `About ${sqft(buildable.maxFootprintM2)} sq ft` : 'Not yet verified'}
                note={buildable.maxFootprintM2 == null ? 'Lot-coverage limits from County Code Ch. 25 still need to be confirmed.' : undefined}
              />
              {rule?.verified && rule.max_height_ft != null && <Row label="Height limit" value={`${rule.max_height_ft} ft`} />}
              {setback.sourceInfo && (
                <Row
                  label="Source"
                  value={
                    <a href={setback.sourceInfo.url} target="_blank" rel="noreferrer">
                      {setback.sourceInfo.title} ↗
                    </a>
                  }
                  note={`${setback.sourceInfo.publisher}, ${setback.sourceInfo.revision}. Table row “${setback.brochure_row}”.`}
                />
              )}
            </dl>
          </>
        ) : (
          <p className="callout">
            We don’t have setback rules for <strong>{lot.zone ?? 'this zone'}</strong> yet, so we’re not showing an
            estimate. Ask Hawaiʻi County Planning.
          </p>
        )}
        <p className="note">Estimates only. Confirm with Hawaii County Planning and a licensed surveyor or architect.</p>
      </section>

      <section>
        <h3>Things the map can’t tell you</h3>
        <ul className="cant">
          <li>Lava tubes and sinkholes under the lot</li>
          <li>Soil depth and how hard it is to clear the land</li>
          <li>Unrecorded easements or access disputes</li>
          <li>Exact boundaries, so get a survey</li>
          <li>Road condition after heavy rain</li>
        </ul>
        <p className="note">Always do a site visit and get a survey before you buy.</p>
      </section>

      <footer className="panel-foot">
        Research aid only, not legal, surveying or real estate advice. Data: Hawaii Statewide GIS Program, checked {checkedOn}.
      </footer>
    </aside>
  )
}
