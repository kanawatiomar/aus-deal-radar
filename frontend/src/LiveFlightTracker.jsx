import {
  Suspense,
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, Line, OrbitControls, Stars, useTexture } from "@react-three/drei";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";

import earthCloudsUrl from "./assets/earth-clouds.png";
import earthDayUrl from "./assets/earth-day.jpg";
import earthLightsUrl from "./assets/earth-lights.png";
import earthNormalUrl from "./assets/earth-normal.jpg";

const EARTH_RADIUS_KM = 6371;
const KNOTS_PER_MPS = 1.94384;
const FEET_PER_METER = 3.28084;
const AUSTIN = { lat: 30.1945, lon: -97.6699 };

const PRESET_CONFIG = {
  world: {
    label: "World",
    description: "Global live traffic",
    bounds: null,
  },
  north_america: {
    label: "North America",
    description: "Bounded feed for North American traffic",
    bounds: { lamin: 14, lomin: -170, lamax: 72, lomax: -52 },
  },
  austin_corridor: {
    label: "Austin Corridor",
    description: "Routes most relevant to AUS-origin travel",
    bounds: { lamin: 15, lomin: -135, lamax: 55, lomax: -55 },
  },
};

const atmosphereMaterial = new THREE.ShaderMaterial({
  uniforms: {
    glowColor: { value: new THREE.Color("#63b8ff") },
  },
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vViewDir;

    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vec4 mvPosition = viewMatrix * worldPosition;
      vNormal = normalize(normalMatrix * normal);
      vViewDir = normalize(-mvPosition.xyz);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 glowColor;
    varying vec3 vNormal;
    varying vec3 vViewDir;

    void main() {
      float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.8);
      gl_FragColor = vec4(glowColor, fresnel * 0.42);
    }
  `,
  transparent: true,
  blending: THREE.AdditiveBlending,
  side: THREE.BackSide,
  depthWrite: false,
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatAltitude(altitudeMeters) {
  if (!altitudeMeters) {
    return "Surface";
  }
  return `${Math.round(altitudeMeters * FEET_PER_METER).toLocaleString()} ft`;
}

function formatSpeed(velocityMps) {
  if (!velocityMps) {
    return "Unknown";
  }
  return `${Math.round(velocityMps * KNOTS_PER_MPS)} kt`;
}

function formatVerticalRate(verticalRateMps) {
  if (verticalRateMps == null) {
    return "Level";
  }
  const feetPerMinute = Math.round(verticalRateMps * FEET_PER_METER * 60);
  if (Math.abs(feetPerMinute) < 60) {
    return "Level";
  }
  return `${feetPerMinute > 0 ? "+" : ""}${feetPerMinute.toLocaleString()} fpm`;
}

function altitudeRadius(altitudeMeters) {
  return 1 + (((altitudeMeters || 0) / 1000) / EARTH_RADIUS_KM);
}

function latLonToVector3(latitude, longitude, altitudeMeters = 0) {
  const lat = THREE.MathUtils.degToRad(latitude);
  const lon = THREE.MathUtils.degToRad(longitude);
  const radius = altitudeRadius(altitudeMeters);
  const cosLat = Math.cos(lat);
  return new THREE.Vector3(
    radius * cosLat * Math.cos(lon),
    radius * Math.sin(lat),
    radius * cosLat * Math.sin(lon),
  );
}

function planeHeadingBasis(latitude, longitude, headingDeg, altitudeMeters = 0) {
  const position = latLonToVector3(latitude, longitude, altitudeMeters);
  const up = position.clone().normalize();
  const east = new THREE.Vector3(
    -Math.sin(THREE.MathUtils.degToRad(longitude)),
    0,
    Math.cos(THREE.MathUtils.degToRad(longitude)),
  ).normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  const heading = THREE.MathUtils.degToRad(headingDeg ?? 0);
  const forward = north.multiplyScalar(Math.cos(heading)).add(east.multiplyScalar(Math.sin(heading))).normalize();
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  const correctedForward = new THREE.Vector3().crossVectors(up, right).normalize();
  return { position, right, forward: correctedForward, up };
}

function haversineDistanceKm(aLat, aLon, bLat, bLon) {
  const lat1 = THREE.MathUtils.degToRad(aLat);
  const lat2 = THREE.MathUtils.degToRad(bLat);
  const deltaLat = lat2 - lat1;
  const deltaLon = THREE.MathUtils.degToRad(bLon - aLon);
  const a =
    (Math.sin(deltaLat / 2) ** 2)
    + (Math.cos(lat1) * Math.cos(lat2) * (Math.sin(deltaLon / 2) ** 2));
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeAircraft(state) {
  if (!Array.isArray(state) || state.length < 17) {
    return null;
  }
  const longitude = state[5];
  const latitude = state[6];
  if (longitude == null || latitude == null) {
    return null;
  }
  const baroAltitude = state[7];
  const geoAltitude = state[13];
  return {
    icao24: String(state[0] || "").trim(),
    callsign: state[1] ? String(state[1]).trim() : null,
    origin_country: String(state[2] || "").trim(),
    longitude: Number(longitude),
    latitude: Number(latitude),
    baro_altitude_m: baroAltitude == null ? null : Number(baroAltitude),
    geo_altitude_m: geoAltitude == null ? null : Number(geoAltitude),
    altitude_m: geoAltitude == null ? (baroAltitude == null ? null : Number(baroAltitude)) : Number(geoAltitude),
    velocity_mps: state[9] == null ? null : Number(state[9]),
    heading_deg: state[10] == null ? null : Number(state[10]),
    vertical_rate_mps: state[11] == null ? null : Number(state[11]),
    on_ground: Boolean(state[8]),
    last_contact: Number(state[4] || 0),
    last_position_update: state[3] == null ? null : Number(state[3]),
    category: state[17] == null ? null : Number(state[17]),
  };
}

function normalizeDirectPayload(payload, preset, includeOnGround) {
  const states = Array.isArray(payload?.states) ? payload.states : [];
  let aircraft = states.map(normalizeAircraft).filter(Boolean);
  if (!includeOnGround) {
    aircraft = aircraft.filter((item) => !item.on_ground);
  }
  return {
    fetched_at: new Date().toISOString(),
    source: "opensky",
    authenticated: false,
    bounds: {
      preset,
      label: PRESET_CONFIG[preset].description,
      ...(PRESET_CONFIG[preset].bounds || {}),
    },
    total_states: states.length,
    airborne_count: aircraft.filter((item) => !item.on_ground).length,
    aircraft,
  };
}

async function fetchSnapshot(config, preset, includeOnGround) {
  const fetchJson = async (url) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Tracker request failed with ${response.status}`);
    }
    return response.json();
  };

  try {
    if (config.sourceMode === "direct") {
      const url = new URL(config.directUrl || "https://opensky-network.org/api/states/all");
      const bounds = PRESET_CONFIG[preset].bounds;
      if (bounds) {
        Object.entries(bounds).forEach(([key, value]) => url.searchParams.set(key, String(value)));
      }
      const payload = await fetchJson(url.toString());
      return normalizeDirectPayload(payload, preset, includeOnGround);
    }

    const url = new URL(config.endpoint, window.location.href);
    url.searchParams.set("preset", preset);
    if (includeOnGround) {
      url.searchParams.set("include_on_ground", "true");
    }
    return await fetchJson(url.toString());
  } catch (error) {
    if (!config.snapshotEndpoint) {
      throw error;
    }
    const snapshotPayload = await fetchJson(config.snapshotEndpoint);
    return {
      ...snapshotPayload,
      source: snapshotPayload.source === "opensky" ? "snapshot" : snapshotPayload.source,
    };
  }
}

function useAircraftFeed(config, preset, includeOnGround) {
  const [feed, setFeed] = useState({
    status: "loading",
    current: null,
    previous: null,
    receivedAt: 0,
    error: null,
  });

  const runFetch = useEffectEvent(async () => {
    try {
      const snapshot = await fetchSnapshot(config, preset, includeOnGround);
      startTransition(() => {
        setFeed((current) => ({
          status: "ready",
          current: snapshot,
          previous: current.current,
          receivedAt: performance.now(),
          error: null,
        }));
      });
    } catch (error) {
      startTransition(() => {
        setFeed((current) => ({
          ...current,
          status: current.current ? "ready" : "error",
          error: error instanceof Error ? error.message : "Unable to load aircraft states.",
        }));
      });
    }
  });

  useEffect(() => {
    let disposed = false;

    const poll = async () => {
      if (!disposed) {
        await runFetch();
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, config.pollMs);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [config.pollMs, includeOnGround, preset, runFetch]);

  return feed;
}

function CloudShell() {
  const cloudMap = useTexture(earthCloudsUrl);
  const meshRef = useRef(null);

  useEffect(() => {
    cloudMap.colorSpace = THREE.SRGBColorSpace;
  }, [cloudMap]);

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.012;
    }
  });

  return (
    <mesh ref={meshRef} scale={1.01}>
      <sphereGeometry args={[1, 96, 96]} />
      <meshStandardMaterial
        alphaMap={cloudMap}
        color="#dff7ff"
        depthWrite={false}
        opacity={0.34}
        transparent
      />
    </mesh>
  );
}

function Earth() {
  const [dayMap, normalMap, lightsMap] = useTexture([
    earthDayUrl,
    earthNormalUrl,
    earthLightsUrl,
  ]);

  useEffect(() => {
    dayMap.colorSpace = THREE.SRGBColorSpace;
    lightsMap.colorSpace = THREE.SRGBColorSpace;
  }, [dayMap, lightsMap]);

  return (
    <group>
      <mesh>
        <sphereGeometry args={[1, 128, 128]} />
        <meshPhongMaterial
          emissive="#ff9d63"
          emissiveIntensity={0.95}
          emissiveMap={lightsMap}
          map={dayMap}
          normalMap={normalMap}
          shininess={12}
          specular="#35608d"
        />
      </mesh>
      <CloudShell />
      <mesh scale={1.065}>
        <sphereGeometry args={[1, 64, 64]} />
        <primitive object={atmosphereMaterial} attach="material" />
      </mesh>
    </group>
  );
}

function AustinBeacon() {
  const groupRef = useRef(null);
  const basePosition = useMemo(() => latLonToVector3(AUSTIN.lat, AUSTIN.lon, 0), []);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      const pulse = 1 + Math.sin(clock.elapsedTime * 2.4) * 0.08;
      groupRef.current.scale.setScalar(pulse);
    }
  });

  return (
    <group ref={groupRef} position={basePosition}>
      <mesh>
        <sphereGeometry args={[0.011, 16, 16]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.028, 0.0026, 12, 32]} />
        <meshBasicMaterial color="#7fe5ff" transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

function AircraftPoints({ aircraft, previousMap, receivedAt, pollMs, selectedIcao }) {
  const geometryRef = useRef(null);
  const positions = useMemo(() => new Float32Array(Math.max(aircraft.length, 1) * 3), [aircraft.length]);
  const colors = useMemo(() => new Float32Array(Math.max(aircraft.length, 1) * 3), [aircraft.length]);

  useFrame(() => {
    if (!geometryRef.current) {
      return;
    }

    const interpolationProgress = clamp(
      receivedAt ? (performance.now() - receivedAt) / pollMs : 1,
      0,
      1,
    );
    const startVector = new THREE.Vector3();
    const endVector = new THREE.Vector3();
    const currentVector = new THREE.Vector3();

    aircraft.forEach((plane, index) => {
      const previous = previousMap.get(plane.icao24) || plane;
      startVector.copy(latLonToVector3(previous.latitude, previous.longitude, previous.altitude_m || 0));
      endVector.copy(latLonToVector3(plane.latitude, plane.longitude, plane.altitude_m || 0));
      currentVector.copy(startVector).lerp(endVector, interpolationProgress);

      const offset = index * 3;
      positions[offset] = currentVector.x;
      positions[offset + 1] = currentVector.y;
      positions[offset + 2] = currentVector.z;

      if (plane.icao24 === selectedIcao) {
        colors[offset] = 1;
        colors[offset + 1] = 0.82;
        colors[offset + 2] = 0.49;
      } else {
        const altitudeMix = clamp((plane.altitude_m || 0) / 12000, 0, 1);
        colors[offset] = 0.42 + ((1 - 0.42) * altitudeMix);
        colors[offset + 1] = 0.9 - (0.34 * altitudeMix);
        colors[offset + 2] = 0.85 - (0.6 * altitudeMix);
      }
    });

    geometryRef.current.setDrawRange(0, aircraft.length);
    geometryRef.current.attributes.position.needsUpdate = true;
    geometryRef.current.attributes.color.needsUpdate = true;
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry ref={geometryRef}>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          usage={THREE.DynamicDrawUsage}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[colors, 3]}
          usage={THREE.DynamicDrawUsage}
        />
      </bufferGeometry>
      <pointsMaterial
        depthWrite={false}
        opacity={0.96}
        size={0.018}
        sizeAttenuation
        transparent
        vertexColors
      />
    </points>
  );
}

function SelectedAircraft({ plane, previousPlane, receivedAt, pollMs, trailPoints }) {
  const groupRef = useRef(null);
  const tempMatrix = useMemo(() => new THREE.Matrix4(), []);
  const tempQuaternion = useMemo(() => new THREE.Quaternion(), []);

  useFrame(() => {
    if (!groupRef.current || !plane) {
      return;
    }

    const interpolationProgress = clamp(
      receivedAt ? (performance.now() - receivedAt) / pollMs : 1,
      0,
      1,
    );
    const start = previousPlane || plane;
    const startVector = latLonToVector3(start.latitude, start.longitude, start.altitude_m || 0);
    const endVector = latLonToVector3(plane.latitude, plane.longitude, plane.altitude_m || 0);
    const currentVector = startVector.lerp(endVector, interpolationProgress);
    const basis = planeHeadingBasis(
      plane.latitude,
      plane.longitude,
      plane.heading_deg ?? 0,
      plane.altitude_m || 0,
    );

    tempMatrix.makeBasis(basis.right, basis.forward, basis.up);
    tempQuaternion.setFromRotationMatrix(tempMatrix);

    groupRef.current.position.copy(currentVector);
    groupRef.current.quaternion.copy(tempQuaternion);
    groupRef.current.scale.setScalar(0.06);
  });

  return (
    <>
      <group ref={groupRef}>
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 1.25, 10]} />
          <meshStandardMaterial color="#fef8df" emissive="#ffb45f" emissiveIntensity={1.1} />
        </mesh>
        <mesh position={[0, 0.02, 0]}>
          <boxGeometry args={[0.9, 0.05, 0.18]} />
          <meshStandardMaterial color="#dceeff" emissive="#4db7ff" emissiveIntensity={0.35} />
        </mesh>
        <mesh position={[0, -0.35, 0]}>
          <boxGeometry args={[0.32, 0.04, 0.14]} />
          <meshStandardMaterial color="#dceeff" emissive="#4db7ff" emissiveIntensity={0.25} />
        </mesh>
        <mesh position={[0, -0.46, 0.09]}>
          <boxGeometry args={[0.04, 0.18, 0.12]} />
          <meshStandardMaterial color="#dceeff" />
        </mesh>
      </group>
      {trailPoints.length > 1 ? (
        <Line
          color="#ffb45f"
          lineWidth={1.2}
          opacity={0.8}
          points={trailPoints}
          transparent
        />
      ) : null}
      <Html position={latLonToVector3(plane.latitude, plane.longitude, plane.altitude_m || 0).multiplyScalar(1.02)}>
        <div className="flight-tracker__label">
          <strong>{plane.callsign || plane.icao24.toUpperCase()}</strong>
          <span>{formatAltitude(plane.altitude_m)}</span>
        </div>
      </Html>
    </>
  );
}

function TrackerScene({
  aircraft,
  previousAircraft,
  pollMs,
  receivedAt,
  selectedAircraft,
  trailPoints,
}) {
  const previousMap = useMemo(
    () => new Map(previousAircraft.map((plane) => [plane.icao24, plane])),
    [previousAircraft],
  );

  return (
    <>
      <color attach="background" args={["#02060c"]} />
      <fogExp2 attach="fog" args={["#02060c", 0.32]} />
      <ambientLight intensity={0.32} />
      <hemisphereLight color="#7ecfff" groundColor="#01050a" intensity={0.42} />
      <directionalLight color="#dff6ff" intensity={2.4} position={[4.4, 2.4, 5.8]} />
      <directionalLight color="#3c7eb7" intensity={0.42} position={[-4, -1.6, -5]} />
      <Stars count={5200} depth={70} factor={3} fade radius={200} saturation={0} speed={0.6} />
      <Suspense fallback={null}>
        <Earth />
      </Suspense>
      <AustinBeacon />
      <AircraftPoints
        aircraft={aircraft}
        previousMap={previousMap}
        pollMs={pollMs}
        receivedAt={receivedAt}
        selectedIcao={selectedAircraft?.icao24 || null}
      />
      {selectedAircraft ? (
        <SelectedAircraft
          plane={selectedAircraft}
          previousPlane={previousMap.get(selectedAircraft.icao24) || null}
          pollMs={pollMs}
          receivedAt={receivedAt}
          trailPoints={trailPoints}
        />
      ) : null}
      <OrbitControls
        autoRotate={!selectedAircraft}
        autoRotateSpeed={0.25}
        dampingFactor={0.08}
        enableDamping
        enablePan={false}
        maxDistance={4.4}
        minDistance={1.8}
      />
      <EffectComposer disableNormalPass multisampling={0}>
        <Bloom
          intensity={1.15}
          luminanceSmoothing={0.2}
          luminanceThreshold={0.16}
          mipmapBlur
          radius={0.72}
        />
        <Noise opacity={0.018} />
        <Vignette darkness={0.78} eskil={false} offset={0.2} />
      </EffectComposer>
    </>
  );
}

function LoadingScene() {
  return (
    <Html center>
      <div className="flight-tracker__canvas-message">Loading live aircraft...</div>
    </Html>
  );
}

export function LiveFlightTracker({ config }) {
  const [preset, setPreset] = useState(config.defaultPreset || "world");
  const [includeOnGround, setIncludeOnGround] = useState(Boolean(config.includeOnGround));
  const [selectedIcao, setSelectedIcao] = useState(null);
  const trailHistoryRef = useRef(new Map());
  const feed = useAircraftFeed(config, preset, includeOnGround);
  const currentAircraft = feed.current?.aircraft || [];
  const previousAircraft = feed.previous?.aircraft || [];
  const deferredAircraft = useDeferredValue(currentAircraft);
  const lastUpdated = feed.current?.fetched_at ? new Date(feed.current.fetched_at) : null;

  const aircraftByIcao = useMemo(
    () => new Map(currentAircraft.map((plane) => [plane.icao24, plane])),
    [currentAircraft],
  );

  const spotlightAircraft = useMemo(() => {
    return [...deferredAircraft]
      .sort((left, right) => {
        if (preset === "austin_corridor") {
          const leftDistance = haversineDistanceKm(AUSTIN.lat, AUSTIN.lon, left.latitude, left.longitude);
          const rightDistance = haversineDistanceKm(AUSTIN.lat, AUSTIN.lon, right.latitude, right.longitude);
          return leftDistance - rightDistance;
        }
        return (right.altitude_m || 0) - (left.altitude_m || 0);
      })
      .slice(0, 10);
  }, [deferredAircraft, preset]);

  useEffect(() => {
    if (!spotlightAircraft.length) {
      setSelectedIcao(null);
      return;
    }
    if (!selectedIcao || !aircraftByIcao.has(selectedIcao)) {
      setSelectedIcao(spotlightAircraft[0].icao24);
    }
  }, [aircraftByIcao, selectedIcao, spotlightAircraft]);

  useEffect(() => {
    if (!feed.current) {
      return;
    }
    const history = trailHistoryRef.current;
    const seen = new Set();

    feed.current.aircraft.forEach((plane) => {
      seen.add(plane.icao24);
      const nextPoint = latLonToVector3(plane.latitude, plane.longitude, plane.altitude_m || 0);
      const existing = history.get(plane.icao24) || [];
      existing.push(nextPoint.toArray());
      history.set(plane.icao24, existing.slice(-18));
    });

    [...history.keys()].forEach((icao24) => {
      if (!seen.has(icao24) && icao24 !== selectedIcao) {
        history.delete(icao24);
      }
    });
  }, [feed.current, selectedIcao]);

  const selectedAircraft = selectedIcao ? aircraftByIcao.get(selectedIcao) || null : null;
  const selectedTrail = selectedAircraft
    ? (trailHistoryRef.current.get(selectedAircraft.icao24) || []).map((point) => new THREE.Vector3(...point))
    : [];

  const metrics = useMemo(() => {
    if (!currentAircraft.length) {
      return {
        averageAltitude: "0 ft",
        maxSpeed: "0 kt",
        topAltitude: "0 ft",
      };
    }

    const altitudeSamples = currentAircraft
      .map((item) => item.altitude_m || 0)
      .filter((value) => value > 0);
    const averageAltitude = altitudeSamples.length
      ? `${Math.round((altitudeSamples.reduce((sum, value) => sum + value, 0) / altitudeSamples.length) * FEET_PER_METER).toLocaleString()} ft`
      : "Surface";
    const maxSpeed = `${Math.round(
      Math.max(...currentAircraft.map((item) => item.velocity_mps || 0)) * KNOTS_PER_MPS,
    )} kt`;
    const topAltitude = `${Math.round(Math.max(...currentAircraft.map((item) => item.altitude_m || 0)) * FEET_PER_METER).toLocaleString()} ft`;
    return { averageAltitude, maxSpeed, topAltitude };
  }, [currentAircraft]);

  return (
    <div className="flight-tracker">
      <div className="flight-tracker__toolbar">
        <div>
          <p className="flight-tracker__eyebrow">Live OpenSky Traffic</p>
          <h3 className="flight-tracker__title">Real aircraft motion on a rotatable 3D Earth.</h3>
          <p className="flight-tracker__copy">
            Smoothly interpolated state vectors, altitude-aware positions, cinematic lighting, and a spotlight feed
            tuned for Austin-based trip hunting.
          </p>
        </div>
        <div className="flight-tracker__control-group">
          {Object.entries(PRESET_CONFIG).map(([key, value]) => (
            <button
              key={key}
              className={`flight-tracker__pill ${preset === key ? "is-active" : ""}`}
              onClick={() => setPreset(key)}
              type="button"
            >
              {value.label}
            </button>
          ))}
          <button
            className={`flight-tracker__pill ${includeOnGround ? "is-active" : ""}`}
            onClick={() => setIncludeOnGround((current) => !current)}
            type="button"
          >
            {includeOnGround ? "Air + Ground" : "Airborne Only"}
          </button>
        </div>
      </div>

      <div className="flight-tracker__layout">
        <div className="flight-tracker__stage">
          <div className="flight-tracker__stage-topbar">
            <span className={`flight-tracker__badge is-${feed.current?.source || "loading"}`}>
              {feed.current?.source === "snapshot" ? "Snapshot Fallback" : "Live OpenSky"}
            </span>
            <span className="flight-tracker__updated">
              {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Connecting to OpenSky"}
            </span>
          </div>
          <Canvas
            camera={{ fov: 38, position: [0, 0, 2.75] }}
            dpr={[1, 1.8]}
            gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          >
            {feed.status === "loading" && !feed.current ? (
              <LoadingScene />
            ) : (
              <TrackerScene
                aircraft={currentAircraft}
                previousAircraft={previousAircraft}
                pollMs={config.pollMs}
                receivedAt={feed.receivedAt}
                selectedAircraft={selectedAircraft}
                trailPoints={selectedTrail}
              />
            )}
          </Canvas>
          <div className="flight-tracker__hud">
            {selectedAircraft ? (
              <>
                <span className="flight-tracker__hud-tag">Tracked Aircraft</span>
                <strong>{selectedAircraft.callsign || selectedAircraft.icao24.toUpperCase()}</strong>
                <p>
                  {selectedAircraft.origin_country} · {formatAltitude(selectedAircraft.altitude_m)} · {formatSpeed(selectedAircraft.velocity_mps)}
                </p>
                <p>
                  Heading {Math.round(selectedAircraft.heading_deg || 0)}° · {formatVerticalRate(selectedAircraft.vertical_rate_mps)}
                </p>
              </>
            ) : (
              <>
                <span className="flight-tracker__hud-tag">Tracker Ready</span>
                <strong>Waiting for an aircraft lock</strong>
                <p>Choose a plane from the live list to spotlight it on the globe.</p>
              </>
            )}
          </div>
          {feed.error ? (
            <div className="flight-tracker__error-banner">{feed.error}</div>
          ) : null}
        </div>

        <aside className="flight-tracker__sidebar">
          <div className="flight-tracker__stats">
            <article>
              <span>Airborne</span>
              <strong>{feed.current?.airborne_count || 0}</strong>
            </article>
            <article>
              <span>Top Altitude</span>
              <strong>{metrics.topAltitude}</strong>
            </article>
            <article>
              <span>Average Altitude</span>
              <strong>{metrics.averageAltitude}</strong>
            </article>
            <article>
              <span>Fastest Speed</span>
              <strong>{metrics.maxSpeed}</strong>
            </article>
          </div>

          <div className="flight-tracker__selected-card">
            <span className="flight-tracker__card-label">Focused Plane</span>
            <strong>{selectedAircraft?.callsign || selectedAircraft?.icao24.toUpperCase() || "No selection"}</strong>
            <p>
              {selectedAircraft
                ? `${selectedAircraft.origin_country} · ${formatAltitude(selectedAircraft.altitude_m)} · ${formatSpeed(selectedAircraft.velocity_mps)}`
                : "The focus card updates when you pick an aircraft from the live list."}
            </p>
          </div>

          <div className="flight-tracker__aircraft-list">
            {spotlightAircraft.map((plane) => (
              <button
                key={plane.icao24}
                className={`flight-tracker__aircraft-card ${selectedIcao === plane.icao24 ? "is-active" : ""}`}
                onClick={() => setSelectedIcao(plane.icao24)}
                type="button"
              >
                <header>
                  <strong>{plane.callsign || plane.icao24.toUpperCase()}</strong>
                  <span>{formatSpeed(plane.velocity_mps)}</span>
                </header>
                <p>{plane.origin_country}</p>
                <div className="flight-tracker__aircraft-meta">
                  <span>{formatAltitude(plane.altitude_m)}</span>
                  <span>{Math.round(plane.heading_deg || 0)}°</span>
                </div>
              </button>
            ))}

            {!spotlightAircraft.length && feed.status === "ready" ? (
              <div className="flight-tracker__empty">
                No aircraft matched the current feed. Try a broader region or include ground traffic.
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
