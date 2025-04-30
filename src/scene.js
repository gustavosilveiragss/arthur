import * as THREE from 'three';

export const createScene = () => {
    const COLORS = {
        BACKGROUND: 0x000000,
        LINE: 0xffffff,
        DOT: 0xffffff,
    };

    const CAMERA = {
        FOV: 75,
        NEAR: 0.1,
        FAR: 1000,
        POSITION_Z: 5,
    };

    const DEFAULTS = {
        PARTICLE_SPEED: 0.05,
        PARTICLE_SIZE: 20,
        PARTICLE_LIFETIME: 1.5,
        SPRAY_WIDTH: 1.0,
        PARTICLE_DENSITY: 2.0,
        DOTS_PER_UNIT: 15,
    };

    const UI = {
        BUTTON_BACKGROUND: '#2196F3',
        BUTTON_BACKGROUND_HOVER: '#1976D2',
        PANEL_BACKGROUND: '#424242',
        TEXT_COLOR: '#e0e0e0',
        HIGHLIGHT_COLOR: '#2196F3',
    };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.BACKGROUND);

    const camera = new THREE.PerspectiveCamera(
        CAMERA.FOV,
        window.innerWidth / window.innerHeight,
        CAMERA.NEAR,
        CAMERA.FAR
    );
    camera.position.z = CAMERA.POSITION_Z;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(renderer.domElement);

    const materials = {
        line: new THREE.LineBasicMaterial({ color: COLORS.LINE, linewidth: 2 }),
        dot: new THREE.MeshBasicMaterial({ color: COLORS.DOT }),
    };

    const sphereGeometry = new THREE.SphereGeometry(0.02, 8, 8);

    const params = {
        particleSpeed: DEFAULTS.PARTICLE_SPEED,
        particleSize: DEFAULTS.PARTICLE_SIZE,
        particleLifetime: DEFAULTS.PARTICLE_LIFETIME,
        sprayWidth: DEFAULTS.SPRAY_WIDTH,
        particleDensity: DEFAULTS.PARTICLE_DENSITY,
    };

    const state = {
        isDrawing: false,
        currentLine: null,
        currentLinePoints: [],
        dots: [],
        uiElements: [],
    };

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const point = new THREE.Vector3();

    setupUI();
    setupEventListeners();
    animate();

    function screenToWorld(clientX, clientY) {
        mouse.set(
            (clientX / window.innerWidth) * 2 - 1,
            -(clientY / window.innerHeight) * 2 + 1
        );
        raycaster.setFromCamera(mouse, camera);
        raycaster.ray.intersectPlane(planeZ, point);
        return point.clone();
    }

    function startLine(event) {
        if (isOverUI(event.clientX, event.clientY)) return;

        state.isDrawing = true;
        const worldPoint = screenToWorld(event.clientX, event.clientY);
        state.currentLinePoints = [worldPoint, worldPoint.clone()];

        const geometry = new THREE.BufferGeometry().setFromPoints(
            state.currentLinePoints
        );
        state.currentLine = new THREE.Line(geometry, materials.line);
        scene.add(state.currentLine);
    }

    function updateLine(event) {
        if (!state.isDrawing) return;

        if (isOverUI(event.clientX, event.clientY)) {
            endLine();
            return;
        }

        state.currentLinePoints.push(
            screenToWorld(event.clientX, event.clientY)
        );

        if (state.currentLine.geometry) state.currentLine.geometry.dispose();
        state.currentLine.geometry = new THREE.BufferGeometry().setFromPoints(
            state.currentLinePoints
        );
    }

    function endLine() {
        if (!state.isDrawing) return;

        state.isDrawing = false;

        if (state.currentLinePoints.length >= 2) {
            createDotsFromLine(state.currentLinePoints);
        }

        if (state.currentLine) {
            scene.remove(state.currentLine);
            if (state.currentLine.geometry)
                state.currentLine.geometry.dispose();
            state.currentLine = null;
        }

        state.currentLinePoints = [];
    }

    function clearScene() {
        for (const dotsGroup of state.dots) {
            scene.remove(dotsGroup);

            for (const sphere of dotsGroup.children) {
                if (sphere.geometry && sphere.userData.needsDisposal) {
                    sphere.geometry.dispose();
                }
            }
        }
        state.dots = [];

        if (state.currentLine) {
            scene.remove(state.currentLine);
            if (state.currentLine.geometry)
                state.currentLine.geometry.dispose();
            state.currentLine = null;
        }

        state.currentLinePoints = [];
    }

    function createDotsFromLine(points) {
        if (points.length < 2) return;

        const pathMetrics = calculatePathMetrics(points);
        const { dotPositions, dotSizes, pathInfo } = generateDotData(
            points,
            pathMetrics
        );

        const dotsGroup = createDotsGroup(
            dotPositions,
            dotSizes,
            pathInfo,
            points,
            pathMetrics.cumulativeDistances,
            pathMetrics.totalLength
        );

        scene.add(dotsGroup);
        state.dots.push(dotsGroup);
    }

    function calculatePathMetrics(points) {
        let totalLength = 0;
        const cumulativeDistances = [0];

        for (let i = 1; i < points.length; i++) {
            const segmentLength = points[i - 1].distanceTo(points[i]);
            totalLength += segmentLength;
            cumulativeDistances.push(
                cumulativeDistances[i - 1] + segmentLength
            );
        }

        return { totalLength, cumulativeDistances };
    }

    function generateDotData(points, pathMetrics) {
        const dotPositions = [];
        const dotSizes = [];
        const pathInfo = [];
        const baseSprayWidth = 0.1;
        const maxSprayWidth = 0.3;

        let currentLength = 0;

        for (let i = 1; i < points.length; i++) {
            const segmentStart = points[i - 1];
            const segmentEnd = points[i];
            const segmentLength = segmentStart.distanceTo(segmentEnd);
            const direction = new THREE.Vector3()
                .subVectors(segmentEnd, segmentStart)
                .normalize();

            const progress = currentLength / pathMetrics.totalLength;
            const densityMultiplier = Math.pow(1 - progress, 3) * 8 + 0.5;

            const numDots = Math.max(
                3,
                Math.floor(
                    segmentLength *
                        DEFAULTS.DOTS_PER_UNIT *
                        densityMultiplier *
                        params.particleDensity
                )
            );

            createDotsForSegment(
                segmentStart,
                segmentEnd,
                direction,
                numDots,
                progress,
                baseSprayWidth,
                maxSprayWidth,
                dotPositions,
                dotSizes,
                pathInfo,
                i - 1,
                currentLength / pathMetrics.totalLength
            );

            currentLength += segmentLength;
        }

        return { dotPositions, dotSizes, pathInfo };
    }

    function createDotsForSegment(
        start,
        end,
        direction,
        numDots,
        progress,
        baseWidth,
        maxWidth,
        positions,
        sizes,
        pathInfo,
        segmentIndex,
        segmentStartProgress
    ) {
        const densityFalloff = Math.exp(-4 * progress);
        const adjustedNumDots = Math.ceil(numDots * densityFalloff);

        for (let j = 0; j < adjustedNumDots; j++) {
            const segmentProgress = Math.pow(Math.random(), 1 + progress * 2);
            const basePosition = new THREE.Vector3().lerpVectors(
                start,
                end,
                segmentProgress
            );

            const sprayWidth =
                (baseWidth + (maxWidth - baseWidth) * Math.pow(progress, 0.8)) *
                params.sprayWidth;
            const randomAngle = Math.random() * Math.PI * 2;

            const spreadFactor = 0.2 + progress * 0.8;
            const xOffset =
                Math.cos(randomAngle) *
                sprayWidth *
                Math.random() *
                spreadFactor;
            const yOffset =
                Math.sin(randomAngle) *
                sprayWidth *
                Math.random() *
                spreadFactor;

            const finalPosition = basePosition
                .clone()
                .add(new THREE.Vector3(xOffset, yOffset, 0));
            positions.push(finalPosition);

            const sizeFactor = 1.2 + 0.5 * Math.pow(1 - progress, 2);
            sizes.push(sizeFactor);

            pathInfo.push({
                segmentIndex,
                segmentProgress,
                pathProgress:
                    segmentStartProgress +
                    segmentProgress * (1 / (positions.length - 1)),
                initialOffset: new THREE.Vector3(xOffset, yOffset, 0),
            });
        }
    }

    function createDotsGroup(
        positions,
        sizes,
        pathInfo,
        pathPoints,
        cumulativeDistances,
        totalPathLength
    ) {
        const group = new THREE.Group();

        group.userData.path = {
            points: pathPoints,
            cumulativeDistances,
            totalLength: totalPathLength,
        };

        positions.forEach((position, index) => {
            const size = sizes[index] || 1;
            const particlePathInfo = pathInfo[index];

            const geometry = sphereGeometry.clone();
            const sphere = new THREE.Mesh(geometry, materials.dot);

            sphere.position.copy(position);
            sphere.userData.needsDisposal = true;
            sphere.userData.originalPosition = position.clone();
            sphere.userData.initialOffset =
                particlePathInfo.initialOffset.clone();
            sphere.userData.baseSize = 0.02 * size * params.particleSize;
            sphere.userData.age = Math.random() * params.particleLifetime;
            sphere.userData.lifetime = params.particleLifetime;
            sphere.userData.speed =
                params.particleSpeed +
                Math.random() * params.particleSpeed * 0.5;
            sphere.userData.pathProgress = particlePathInfo.pathProgress;

            group.add(sphere);
        });

        return group;
    }

    function updateDots(delta) {
        if (delta <= 0 || delta >= 0.1) return;

        for (const dotsGroup of state.dots) {
            const pathData = dotsGroup.userData.path;

            for (const dot of dotsGroup.children) {
                dot.userData.age += delta;

                if (dot.userData.age > dot.userData.lifetime) {
                    dot.userData.age = 0;
                    dot.position.copy(dot.userData.originalPosition);
                    dot.userData.pathProgress = getPathProgressFromPosition(
                        dot.position,
                        pathData.points,
                        dot.userData.initialOffset
                    );
                }

                const progress = dot.userData.age / dot.userData.lifetime;
                updateDotSize(dot, progress);

                const moveAmount = dot.userData.speed * delta;
                const distanceToMove = moveAmount * pathData.totalLength;

                dot.userData.pathProgress +=
                    distanceToMove / pathData.totalLength;

                updateParticlePositionAlongPath(
                    dot,
                    dot.userData.pathProgress,
                    pathData.points,
                    pathData.cumulativeDistances,
                    pathData.totalLength,
                    dot.userData.initialOffset
                );
            }
        }
    }

    function updateDotSize(dot, progress) {
        let sizeFactor;
        if (progress < 0.5) {
            sizeFactor = THREE.MathUtils.mapLinear(progress, 0, 0.5, 0.2, 1.2);
        } else {
            sizeFactor = THREE.MathUtils.mapLinear(progress, 0.5, 1, 1.2, 0.2);
        }

        const scale = dot.userData.baseSize * sizeFactor;
        dot.scale.set(scale, scale, scale);
    }

    function getPathProgressFromPosition(position, pathPoints, offset) {
        let minDist = Infinity;
        let closestSegmentIndex = 0;
        let closestProgress = 0;

        const basePosition = position.clone().sub(offset);

        for (let i = 1; i < pathPoints.length; i++) {
            const start = pathPoints[i - 1];
            const end = pathPoints[i];

            const line = new THREE.Line3(start, end);
            const closestPoint = new THREE.Vector3();
            line.closestPointToPoint(basePosition, true, closestPoint);

            const distance = basePosition.distanceTo(closestPoint);
            if (distance < minDist) {
                minDist = distance;
                closestSegmentIndex = i - 1;

                const segmentLength = start.distanceTo(end);
                const startToClosest = start.distanceTo(closestPoint);
                const segmentProgress =
                    segmentLength > 0 ? startToClosest / segmentLength : 0;

                closestProgress = segmentProgress;
            }
        }

        let pathLengthBeforeSegment = 0;
        let totalPathLength = 0;

        for (let i = 1; i < pathPoints.length; i++) {
            const segmentLength = pathPoints[i - 1].distanceTo(pathPoints[i]);
            if (i - 1 < closestSegmentIndex) {
                pathLengthBeforeSegment += segmentLength;
            }
            totalPathLength += segmentLength;
        }

        const currentSegmentLength = pathPoints[closestSegmentIndex].distanceTo(
            pathPoints[closestSegmentIndex + 1]
        );

        return (
            (pathLengthBeforeSegment + closestProgress * currentSegmentLength) /
            totalPathLength
        );
    }

    function updateParticlePositionAlongPath(
        particle,
        progress,
        pathPoints,
        cumulativeDistances,
        totalLength,
        offset
    ) {
        progress = progress % 1;

        const targetDistance = progress * totalLength;
        let segmentIndex = 0;

        for (let i = 0; i < cumulativeDistances.length - 1; i++) {
            if (
                targetDistance >= cumulativeDistances[i] &&
                targetDistance < cumulativeDistances[i + 1]
            ) {
                segmentIndex = i;
                break;
            }
        }

        const segmentStart = pathPoints[segmentIndex];
        const segmentEnd = pathPoints[segmentIndex + 1];

        const segmentLength = segmentEnd.distanceTo(segmentStart);
        const segmentStartDistance = cumulativeDistances[segmentIndex];
        const segmentProgress =
            segmentLength > 0
                ? (targetDistance - segmentStartDistance) / segmentLength
                : 0;

        const basePosition = new THREE.Vector3().lerpVectors(
            segmentStart,
            segmentEnd,
            segmentProgress
        );

        particle.position.copy(basePosition).add(offset);
    }

    function setupUI() {
        const clearBtn = createClearButton();
        document.body.appendChild(clearBtn);
        state.uiElements.push(clearBtn);

        const controls = createControlPanel();
        document.body.appendChild(controls.panel);
        state.uiElements.push(controls.panel);
    }

    function isOverUI(x, y) {
        for (const element of state.uiElements) {
            const rect = element.getBoundingClientRect();
            if (
                x >= rect.left &&
                x <= rect.right &&
                y >= rect.top &&
                y <= rect.bottom
            ) {
                return true;
            }
        }
        return false;
    }

    function createClearButton() {
        const btn = document.createElement('button');
        btn.textContent = 'clear';
        Object.assign(btn.style, {
            position: 'fixed',
            bottom: '15px',
            right: '15px',
            background: UI.BUTTON_BACKGROUND,
            color: 'white',
            fontSize: '11px',
            fontFamily: 'Roboto, Arial, sans-serif',
            fontWeight: '400',
            border: 'none',
            borderRadius: '3px',
            padding: '6px 12px',
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            textTransform: 'lowercase',
            letterSpacing: '0.5px',
            transition: 'background 0.3s, transform 0.2s, box-shadow 0.3s',
            zIndex: '1000',
        });

        btn.addEventListener('mouseover', () => {
            btn.style.background = UI.BUTTON_BACKGROUND_HOVER;
            btn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
        });

        btn.addEventListener('mouseout', () => {
            btn.style.background = UI.BUTTON_BACKGROUND;
            btn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
        });

        btn.addEventListener('mousedown', () => {
            btn.style.transform = 'scale(0.95)';
        });

        btn.addEventListener('mouseup', () => {
            btn.style.transform = 'scale(1)';
        });

        btn.addEventListener('click', clearScene);

        return btn;
    }

    function createControlPanel() {
        const panel = document.createElement('div');
        Object.assign(panel.style, {
            position: 'fixed',
            top: '15px',
            left: '15px',
            background: UI.PANEL_BACKGROUND,
            color: UI.TEXT_COLOR,
            padding: '12px',
            borderRadius: '3px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            zIndex: '1000',
            width: '200px',
            fontFamily: 'Roboto, Arial, sans-serif',
        });

        const controls = {};

        controls.speed = createSlider(
            'Speed',
            0.05,
            2,
            params.particleSpeed,
            0.01,
            (value) => {
                params.particleSpeed = parseFloat(value);
            }
        );
        panel.appendChild(controls.speed);

        controls.size = createSlider(
            'Size',
            20,
            80.0,
            params.particleSize,
            5,
            (value) => {
                params.particleSize = parseFloat(value);
            }
        );
        panel.appendChild(controls.size);

        controls.spray = createSlider(
            'Spray Width',
            0.5,
            5.0,
            params.sprayWidth,
            0.5,
            (value) => {
                params.sprayWidth = parseFloat(value);
            }
        );
        panel.appendChild(controls.spray);

        controls.density = createSlider(
            'Density',
            0.1,
            10,
            params.particleDensity,
            0.1,
            (value) => {
                params.particleDensity = parseFloat(value);
            }
        );
        panel.appendChild(controls.density);

        return { panel, controls };
    }

    function createSlider(label, min, max, value, step, onChange) {
        const container = document.createElement('div');
        Object.assign(container.style, {
            marginBottom: '10px',
        });

        const labelElement = document.createElement('div');
        labelElement.textContent = label;
        Object.assign(labelElement.style, {
            marginBottom: '3px',
            fontSize: '12px',
            fontWeight: '400',
            color: UI.TEXT_COLOR,
        });

        const valueElement = document.createElement('span');
        valueElement.textContent = value;
        Object.assign(valueElement.style, {
            float: 'right',
            color: UI.HIGHLIGHT_COLOR,
            fontWeight: '400',
            fontSize: '12px',
        });
        labelElement.appendChild(valueElement);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = value;
        Object.assign(slider.style, {
            width: '100%',
            height: '20px',
            margin: '3px 0',
            appearance: 'none',
            background: '#333333',
            outline: 'none',
            opacity: '0.9',
            transition: 'opacity 0.2s',
            borderRadius: '2px',
        });

        const sliderStyles = document.createElement('style');
        sliderStyles.textContent = `
            input[type=range]::-webkit-slider-thumb {
                appearance: none;
                width: 12px;
                height: 12px;
                background: ${UI.HIGHLIGHT_COLOR};
                border-radius: 50%;
                cursor: pointer;
                transition: background 0.3s;
            }
            input[type=range]::-webkit-slider-thumb:hover {
                background: ${UI.BUTTON_BACKGROUND_HOVER};
            }
            input[type=range]::-moz-range-thumb {
                width: 12px;
                height: 12px;
                background: ${UI.HIGHLIGHT_COLOR};
                border-radius: 50%;
                cursor: pointer;
                border: none;
                transition: background 0.3s;
            }
            input[type=range]::-moz-range-thumb:hover {
                background: ${UI.BUTTON_BACKGROUND_HOVER};
            }
        `;
        document.head.appendChild(sliderStyles);

        slider.addEventListener('input', () => {
            onChange(slider.value);
            valueElement.textContent = slider.value;
        });

        slider.addEventListener('mouseover', () => {
            slider.style.opacity = '1';
        });

        slider.addEventListener('mouseout', () => {
            slider.style.opacity = '0.9';
        });

        container.appendChild(labelElement);
        container.appendChild(slider);

        return container;
    }

    function setupEventListeners() {
        window.addEventListener('mousedown', startLine);
        window.addEventListener('mousemove', updateLine);
        window.addEventListener('mouseup', endLine);
        window.addEventListener('resize', handleResize);
    }

    function handleResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    function animate(time = 0) {
        const lastTime = animate.lastTime || 0;
        const delta = (time - lastTime) / 1000;
        animate.lastTime = time;

        requestAnimationFrame(animate);
        updateDots(delta);
        renderer.render(scene, camera);
    }

    return {
        dispose: () => {
            window.removeEventListener('mousedown', startLine);
            window.removeEventListener('mousemove', updateLine);
            window.removeEventListener('mouseup', endLine);
            window.removeEventListener('resize', handleResize);

            clearScene();

            for (const element of state.uiElements) {
                document.body.removeChild(element);
            }
            document.body.removeChild(renderer.domElement);

            sphereGeometry.dispose();
            materials.dot.dispose();
            materials.line.dispose();
            renderer.dispose();
        },
    };
};
