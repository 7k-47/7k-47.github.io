(() => {
  'use strict';

  const VERSION = 'vertical-loop/2.0.0';
  const FULL_TURN = 2 * Math.PI;
  const TO_DEGREES = 180 / Math.PI;
  const ARC_STEPS = 640;
  const TIME_SAMPLES = 200;

  function number(parameters, key, fallback, minimum) {
    const value = Number(parameters[key] ?? fallback);
    return Math.max(minimum, Number.isFinite(value) ? value : fallback);
  }

  function angleForProgress(endAngle, progress) {
    return endAngle * (1 - (1 - progress) ** 2);
  }

  function arcSpeedSquared(motion, angle) {
    if (motion.outcome === 'returned') {
      // This equivalent expression avoids subtracting two nearly equal energies at the turning point.
      const remaining = Math.max(0, motion.endAngle - angle);
      return 4 * motion.gravityRadius * Math.sin(motion.endAngle - remaining / 2) * Math.sin(remaining / 2);
    }
    const sine = Math.sin(angle / 2);
    return Math.max(0, motion.speedAtMSquared - 4 * motion.gravityRadius * sine * sine);
  }

  function makeArcTimes(motion, radius, gravity) {
    const { endAngle, outcome, gravityRadius } = motion;
    const times = [0];
    if (endAngle === 0) return times;

    // Quadratic spacing makes the integrand finite even when the speed falls to zero at the endpoint.
    function timeSlope(progress) {
      const tail = 1 - progress;
      if (outcome === 'returned') {
        if (tail === 0) return Math.sqrt(2 * radius * endAngle / (gravity * Math.sin(endAngle)));
        const remaining = endAngle * tail * tail;
        const speedSquared = 4 * gravityRadius * Math.sin(endAngle - remaining / 2) * Math.sin(remaining / 2);
        return 2 * radius * endAngle * tail / Math.sqrt(speedSquared);
      }
      if (tail === 0) return 0;
      const speedSquared = arcSpeedSquared(motion, angleForProgress(endAngle, progress));
      return 2 * radius * endAngle * tail / Math.sqrt(speedSquared);
    }

    let start = timeSlope(0);
    for (let index = 1; index <= ARC_STEPS; index++) {
      const midpoint = timeSlope((index - .5) / ARC_STEPS);
      const end = timeSlope(index / ARC_STEPS);
      const duration = (start + 4 * midpoint + end) / (6 * ARC_STEPS);
      times.push(times[index - 1] + duration);
      start = end;
    }
    return times;
  }

  function angleAtTime(motion, time) {
    const { arcTimes, endAngle } = motion;
    const last = arcTimes.length - 1;
    if (time <= 0 || last === 0) return 0;
    if (time >= arcTimes[last]) return endAngle;
    let left = 0;
    let right = last;
    while (right - left > 1) {
      const center = Math.floor((left + right) / 2);
      if (arcTimes[center] <= time) left = center;
      else right = center;
    }
    const fraction = (time - arcTimes[left]) / (arcTimes[right] - arcTimes[left]);
    return angleForProgress(endAngle, (left + fraction) / last);
  }

  function timeAtAngle(motion, angle) {
    const { arcTimes, endAngle } = motion;
    if (angle <= 0 || endAngle === 0) return 0;
    if (angle >= endAngle) return arcTimes[arcTimes.length - 1];
    const progress = 1 - Math.sqrt(1 - angle / endAngle);
    const position = progress * (arcTimes.length - 1);
    const index = Math.floor(position);
    return arcTimes[index] + (arcTimes[index + 1] - arcTimes[index]) * (position - index);
  }

  function arcPosition(radius, angle) {
    const halfSine = Math.sin(angle / 2);
    return {
      x: angle === 0 || angle === Math.PI || angle === FULL_TURN ? 0 : radius * Math.sin(angle),
      y: angle === FULL_TURN ? 0 : 2 * radius * halfSine * halfSine,
    };
  }

  function readingsAtAngle(result, angle) {
    const speedSquared = arcSpeedSquared(result.motion, angle);
    const centripetal = result.massKg * speedSquared / result.radius;
    const gravityRadial = -result.massKg * result.g * Math.cos(angle);
    const radialDifference = centripetal - gravityRadial;
    const tolerance = 32 * Number.EPSILON * Math.max(1, centripetal, Math.abs(gravityRadial));
    return {
      angleDeg: angle * TO_DEGREES,
      speed: Math.sqrt(speedSquared),
      height: arcPosition(result.radius, angle).y,
      normalForce: radialDifference > tolerance ? radialDifference : 0,
      centripetal,
      gravityRadial,
    };
  }

  function makeState(time, phase, position, speed, angleDeg, gravity, normal, drive) {
    return {
      time,
      phase,
      position,
      speed,
      angleDeg,
      gravity,
      normal,
      drive,
      net: [gravity[0] + normal[0] + drive[0], gravity[1] + normal[1] + drive[1]],
    };
  }

  function sample(result, requestedTime = 0) {
    if (!result?.motion) return null;
    const { g, horizontalLength, massKg, initialSpeed, appliedForce, duration, outcome, motion } = result;
    const { launchDuration, arcDuration, detachment } = motion;
    const value = Number(requestedTime);
    const time = Math.max(0, Math.min(duration, Number.isNaN(value) ? 0 : value));
    const weight = massKg * g;
    const gravity = [0, -weight];
    if (outcome === 'stationary') {
      return makeState(time, 'stationary', { x: -horizontalLength, y: 0 }, 0, null, gravity, [0, weight], [0, 0]);
    }
    if (time < launchDuration) {
      const acceleration = appliedForce / massKg;
      const x = Math.min(0, -horizontalLength + initialSpeed * time + .5 * acceleration * time * time);
      return makeState(time, 'launch', { x, y: 0 }, initialSpeed + acceleration * time, null, gravity, [0, weight], [appliedForce, 0]);
    }

    const boundary = launchDuration + arcDuration;
    if (outcome === 'detached' && time >= boundary) {
      const flightTime = time - boundary;
      const { position, velocity } = detachment;
      const x = position.x + velocity[0] * flightTime;
      const y = Math.max(0, position.y + velocity[1] * flightTime - .5 * g * flightTime * flightTime);
      const speed = Math.hypot(velocity[0], velocity[1] - g * flightTime);
      return makeState(time, 'airborne', { x, y }, speed, null, gravity, [0, 0], [0, 0]);
    }
    const returning = outcome === 'returned' && time >= boundary;
    const elapsed = returning ? duration - time : time === duration ? arcDuration : time - launchDuration;
    const angle = angleAtTime(motion, elapsed);
    const { speed, angleDeg, normalForce } = readingsAtAngle(result, angle);
    const normal = normalForce === 0 ? [0, 0] : [-normalForce * Math.sin(angle), normalForce * Math.cos(angle)];
    return makeState(time, returning ? 'return' : 'loop', arcPosition(result.radius, angle), speed, angleDeg, gravity, normal, [0, 0]);
  }

  function pointReadings(result, id, label, angle, reached) {
    const reading = reached ? readingsAtAngle(result, angle) : null;
    const speed = reading?.speed ?? null;
    const normalForce = reading?.normalForce ?? null;
    return {
      id, label,
      angleDeg: angle * TO_DEGREES,
      speed,
      height: arcPosition(result.radius, angle).y,
      normalForce,
      reached,
      critical: id === 'Q' && reached && normalForce === 0,
    };
  }

  function collectTimeline(result) {
    const { duration, motion } = result;
    if (duration === 0) return [sample(result)];
    const times = [];
    for (let index = 0; index <= TIME_SAMPLES; index++) times.push(duration * index / TIME_SAMPLES);
    times.push(motion.launchDuration, motion.launchDuration + motion.arcDuration, duration);
    if (motion.endAngle >= Math.PI / 2) times.push(motion.launchDuration + timeAtAngle(motion, Math.PI / 2));
    if (result.reachesTop) times.push(motion.launchDuration + timeAtAngle(motion, Math.PI));
    if (motion.detachment) times.push(motion.launchDuration + motion.arcDuration + motion.detachment.velocity[1] / result.g);
    return [...new Set(times)].sort((first, second) => first - second).map(time => sample(result, time));
  }

  function collectTrack(result) {
    const { endAngle } = result.motion;
    if (endAngle === 0) return [];
    const readings = [];
    const step = 2 / TO_DEGREES;
    for (let index = 0; index * step < endAngle - 1e-12; index++) {
      readings.push(readingsAtAngle(result, index * step));
    }
    readings.push(readingsAtAngle(result, endAngle));
    return readings;
  }

  function solve(parameters = {}, options = {}) {
    const g = number(parameters, 'gravity', 10, 1);
    const horizontalLength = number(parameters, 'horizontalLength', 5, .01);
    const radius = number(parameters, 'radius', 1.6, .01);
    const massKg = number(parameters, 'massKg', 1, .01);
    const appliedForce = number(parameters, 'appliedForce', 8, 0);
    const initialSpeed = number(parameters, 'initialSpeed', 0, 0);
    const appliedWork = appliedForce * horizontalLength;
    const gravityRadius = g * radius;
    const criticalSpeedM = Math.sqrt(5 * gravityRadius);
    const criticalSpeedQ = Math.sqrt(gravityRadius);
    const requiredForce = Math.max(0, (5 * gravityRadius - initialSpeed * initialSpeed) * massKg / (2 * horizontalLength));
    const requiredInitialSpeed = Math.sqrt(Math.max(0, 5 * gravityRadius - 2 * appliedWork / massKg));
    const speedAtMSquared = initialSpeed * initialSpeed + 2 * appliedWork / massKg;
    const speedAtM = Math.sqrt(speedAtMSquared);
    const energyRatio = speedAtMSquared / gravityRadius;
    const tolerance = 32 * Number.EPSILON * Math.max(1, energyRatio);

    let outcome;
    let endAngle;
    if (speedAtM === 0) {
      outcome = 'stationary';
      endAngle = 0;
    } else if (energyRatio >= 5 - tolerance) {
      outcome = 'completed';
      endAngle = FULL_TURN;
    } else if (energyRatio > 2 + tolerance) {
      outcome = 'detached';
      endAngle = Math.acos((2 - energyRatio) / 3);
    } else {
      outcome = 'returned';
      endAngle = 2 * Math.asin(Math.min(1, speedAtM / (2 * criticalSpeedQ)));
    }

    const launchDuration = speedAtM === 0 ? 0 : 2 * horizontalLength / (initialSpeed + speedAtM);
    const motion = { outcome, endAngle, gravityRadius, speedAtMSquared, launchDuration, arcDuration: 0, arcTimes: [], detachment: null };
    motion.arcTimes = makeArcTimes(motion, radius, g);
    motion.arcDuration = motion.arcTimes[motion.arcTimes.length - 1];

    let duration = launchDuration + motion.arcDuration;
    let finalReason = outcome === 'completed' ? 'loop_complete' : 'zero_launch_speed';
    let maxHeightM = outcome === 'completed' ? 2 * radius : arcPosition(radius, endAngle).y;
    if (outcome === 'returned') {
      duration += motion.arcDuration;
      finalReason = 'returned_to_bottom';
    }
    if (outcome === 'detached') {
      const position = arcPosition(radius, endAngle);
      const speed = Math.sqrt(arcSpeedSquared(motion, endAngle));
      const velocity = [speed * Math.cos(endAngle), speed * Math.sin(endAngle)];
      // At separation the constant, linear and quadratic terms of the squared distance from the circle cancel.
      // The remaining terms are -g*v_y*t^3 + g^2*t^4/4, giving the first later circle intersection.
      const recontactTime = 4 * velocity[1] / g;
      const groundTime = (velocity[1] + Math.sqrt(velocity[1] ** 2 + 2 * g * position.y)) / g;
      const flightDuration = Math.min(recontactTime, groundTime);
      motion.detachment = { time: duration, angleDeg: endAngle * TO_DEGREES, position, velocity, flightDuration };
      finalReason = recontactTime < groundTime ? 'track_recontact' : 'ground_recontact';
      duration += flightDuration;
      maxHeightM += velocity[1] ** 2 / (2 * g);
    }

    const reachesTop = outcome === 'completed';
    const leavesTrack = outcome === 'detached';
    const result = {
      solverVersion: VERSION,
      mode: options.mode ?? 'theoretical',
      g,
      horizontalLength,
      radius,
      massKg,
      initialSpeed,
      appliedForce,
      requiredInitialSpeed,
      requiredForce,
      criticalSpeedM,
      criticalSpeedQ,
      speedAtM,
      speedAtQ: reachesTop ? Math.sqrt(arcSpeedSquared(motion, Math.PI)) : null,
      reachesTop,
      leavesTrack,
      leaveAngleDeg: leavesTrack ? endAngle * TO_DEGREES : null,
      maxAngleDeg: endAngle * TO_DEGREES,
      maxHeightM,
      launchDuration,
      arcDuration: motion.arcDuration,
      flightDuration: motion.detachment?.flightDuration ?? 0,
      duration,
      outcome,
      finalReason,
      motion,
    };
    result.pointM = pointReadings(result, 'M', '最低点 M', 0, outcome !== 'stationary');
    result.pointP = pointReadings(result, 'P', '侧向点 P', Math.PI / 2, endAngle >= Math.PI / 2 - tolerance);
    result.pointQ = pointReadings(result, 'Q', '最高点 Q', Math.PI, reachesTop);
    result.trackSamples = collectTrack(result);
    result.samples = collectTimeline(result);
    return result;
  }

  globalThis.PhysicsCircularMotion = { solve, sample };
})();
