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

    const fpsState = {
        frameCount: 0,
        lastFrameTime: performance.now(),
        lastFpsUpdate: performance.now(),
        fps: 0,
        fpsElement: null,
    };

    const FPS_TARGET = 30;
    const FRAME_INTERVAL = 1000 / FPS_TARGET;
    let lastTime = 0;

    function setupViewport() {
        if (!document.querySelector('meta[name="viewport"]')) {
            const meta = document.createElement('meta');
            meta.name = 'viewport';
            meta.content =
                'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
            document.head.appendChild(meta);
        }
    }

    setupViewport();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.BACKGROUND);

    const camera = new THREE.PerspectiveCamera(
        CAMERA.FOV,
        window.innerWidth / window.innerHeight,
        CAMERA.NEAR,
        CAMERA.FAR,
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

    let currentColor = '#ffffff';

    const state = {
        isDrawing: false,
        currentLine: null,
        currentLinePoints: [],
        dots: [],
        uiElements: [],
        touchStartedOverUI: false,
        isMobile: isMobileDevice(),
    };

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const point = new THREE.Vector3();

    setupUI();
    setupEventListeners();
    animate();

    function isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
            navigator.userAgent,
        );
    }

    function screenToWorld(clientX, clientY) {
        mouse.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
        raycaster.setFromCamera(mouse, camera);
        raycaster.ray.intersectPlane(planeZ, point);
        return point.clone();
    }

    function startLine(event) {
        if (isOverUI(event.clientX, event.clientY)) return;

        state.isDrawing = true;
        const worldPoint = screenToWorld(event.clientX, event.clientY);
        state.currentLinePoints = [worldPoint, worldPoint.clone()];

        const geometry = new THREE.BufferGeometry().setFromPoints(state.currentLinePoints);
        const lineMaterial = materials.line.clone();
        lineMaterial.color.set(currentColor);
        state.currentLine = new THREE.Line(geometry, lineMaterial);
        scene.add(state.currentLine);
    }

    function updateLine(event) {
        if (!state.isDrawing) return;

        if (isOverUI(event.clientX, event.clientY)) {
            endLine();
            return;
        }

        state.currentLinePoints.push(screenToWorld(event.clientX, event.clientY));

        if (state.currentLine.geometry) state.currentLine.geometry.dispose();
        state.currentLine.geometry = new THREE.BufferGeometry().setFromPoints(
            state.currentLinePoints,
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
            if (state.currentLine.geometry) state.currentLine.geometry.dispose();
            state.currentLine = null;
        }

        state.currentLinePoints = [];
    }

    function clearScene() {
        for (const dotsGroup of state.dots) {
            scene.remove(dotsGroup.instancedMesh);
            dotsGroup.instancedMesh.geometry.dispose();
        }
        state.dots = [];

        if (state.currentLine) {
            scene.remove(state.currentLine);
            if (state.currentLine.geometry) state.currentLine.geometry.dispose();
            state.currentLine = null;
        }

        state.currentLinePoints = [];
    }

    function createDotsFromLine(points) {
        if (points.length < 2) return;

        const pathMetrics = calculatePathMetrics(points);
        const { dotPositions, dotSizes, pathInfo } = generateDotData(points, pathMetrics);

        const dotsGroup = createDotsGroup(
            dotPositions,
            dotSizes,
            pathInfo,
            points,
            pathMetrics.cumulativeDistances,
            pathMetrics.totalLength,
        );

        scene.add(dotsGroup.instancedMesh);
        state.dots.push(dotsGroup);
    }

    function calculatePathMetrics(points) {
        let totalLength = 0;
        const cumulativeDistances = [0];

        for (let i = 1; i < points.length; i++) {
            const segmentLength = points[i - 1].distanceTo(points[i]);
            totalLength += segmentLength;
            cumulativeDistances.push(cumulativeDistances[i - 1] + segmentLength);
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
            const direction = new THREE.Vector3().subVectors(segmentEnd, segmentStart).normalize();

            const progress = currentLength / pathMetrics.totalLength;
            const densityMultiplier = Math.pow(1 - progress, 3) * 8 + 0.5;

            const numDots = Math.max(
                3,
                Math.floor(
                    segmentLength *
                        DEFAULTS.DOTS_PER_UNIT *
                        densityMultiplier *
                        params.particleDensity,
                ),
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
                currentLength / pathMetrics.totalLength,
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
        segmentStartProgress,
    ) {
        const densityFalloff = Math.exp(-4 * progress);
        const adjustedNumDots = Math.ceil(numDots * densityFalloff);

        for (let j = 0; j < adjustedNumDots; j++) {
            const segmentProgress = Math.pow(Math.random(), 1 + progress * 2);
            const basePosition = new THREE.Vector3().lerpVectors(start, end, segmentProgress);

            const sprayWidth =
                (baseWidth + (maxWidth - baseWidth) * Math.pow(progress, 0.8)) * params.sprayWidth;
            const randomAngle = Math.random() * Math.PI * 2;

            const spreadFactor = 0.2 + progress * 0.8;
            const xOffset = Math.cos(randomAngle) * sprayWidth * Math.random() * spreadFactor;
            const yOffset = Math.sin(randomAngle) * sprayWidth * Math.random() * spreadFactor;

            const finalPosition = basePosition.clone().add(new THREE.Vector3(xOffset, yOffset, 0));
            positions.push(finalPosition);

            const sizeFactor = 1.2 + 0.5 * Math.pow(1 - progress, 2);
            sizes.push(sizeFactor);

            pathInfo.push({
                segmentIndex,
                segmentProgress,
                pathProgress: segmentStartProgress + segmentProgress * (1 / (positions.length - 1)),
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
        totalPathLength,
    ) {
        const count = positions.length;
        const dotMaterial = materials.dot.clone();
        dotMaterial.color.set(currentColor);
        const instancedMesh = new THREE.InstancedMesh(
            sphereGeometry,
            dotMaterial,
            count
        );
        instancedMesh.count = count;

        const group = {
            instancedMesh,
            count,
            userData: {
                path: {
                    points: pathPoints,
                    cumulativeDistances,
                    totalLength: totalPathLength,
                },
                particles: Array(count),
            },
        };

        // Create particle data and set initial transforms
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        positions.forEach((pos, index) => {
            const size = sizes[index] || 1;
            const particlePathInfo = pathInfo[index];

            const particle = {
                originalPosition: pos.clone(),
                initialOffset: particlePathInfo.initialOffset.clone(),
                baseSize: 0.02 * size * params.particleSize,
                age: Math.random() * params.particleLifetime,
                lifetime: params.particleLifetime,
                speed: params.particleSpeed + Math.random() * params.particleSpeed * 0.5,
                pathProgress: particlePathInfo.pathProgress,
            };

            group.userData.particles[index] = particle;

            // Set initial transform
            position.copy(pos);
            quaternion.identity();
            scale.setScalar(particle.baseSize);
            matrix.compose(position, quaternion, scale);
            instancedMesh.setMatrixAt(index, matrix);
        });

        instancedMesh.instanceMatrix.needsUpdate = true;

        return group;
    }

    function updateDots(delta) {
        if (delta <= 0 || delta >= 0.1) return;

        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        for (const dotsGroup of state.dots) {
            const pathData = dotsGroup.userData.path;
            const instancedMesh = dotsGroup.instancedMesh;
            let needsUpdate = false;

            for (let i = 0; i < dotsGroup.count; i++) {
                const particle = dotsGroup.userData.particles[i];
                particle.age += delta;

                if (particle.age > particle.lifetime) {
                    particle.age = 0;
                    particle.pathProgress = getPathProgressFromPosition(
                        particle.originalPosition,
                        pathData.points,
                        particle.initialOffset,
                    );
                }

                const progress = particle.age / particle.lifetime;

                // Update size
                let sizeFactor;
                if (progress < 0.5) {
                    sizeFactor = THREE.MathUtils.mapLinear(progress, 0, 0.5, 0.2, 1.2);
                } else {
                    sizeFactor = THREE.MathUtils.mapLinear(progress, 0.5, 1, 1.2, 0.2);
                }
                const scaleValue = particle.baseSize * sizeFactor;

                // Update position
                const moveAmount = particle.speed * delta;
                const distanceToMove = moveAmount * pathData.totalLength;
                particle.pathProgress += distanceToMove / pathData.totalLength;

                updateParticlePositionAlongPath(
                    position,
                    particle.pathProgress,
                    pathData.points,
                    pathData.cumulativeDistances,
                    pathData.totalLength,
                    particle.initialOffset,
                );

                // Apply transform
                quaternion.identity();
                scale.setScalar(scaleValue);
                matrix.compose(position, quaternion, scale);
                instancedMesh.setMatrixAt(i, matrix);
                needsUpdate = true;
            }

            if (needsUpdate) {
                instancedMesh.instanceMatrix.needsUpdate = true;
            }
        }
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
                const segmentProgress = segmentLength > 0 ? startToClosest / segmentLength : 0;

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
            pathPoints[closestSegmentIndex + 1],
        );

        return (pathLengthBeforeSegment + closestProgress * currentSegmentLength) / totalPathLength;
    }

    function updateParticlePositionAlongPath(
        outPosition,
        progress,
        pathPoints,
        cumulativeDistances,
        totalLength,
        offset,
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
            segmentLength > 0 ? (targetDistance - segmentStartDistance) / segmentLength : 0;

        const basePosition = new THREE.Vector3().lerpVectors(
            segmentStart,
            segmentEnd,
            segmentProgress,
        );

        outPosition.copy(basePosition).add(offset);
    }

    function handleTouchStart(event) {
        event.preventDefault();

        const touch = event.touches[0];
        state.touchStartedOverUI = isOverUI(touch.clientX, touch.clientY);

        if (!state.touchStartedOverUI) {
            startLine({
                clientX: touch.clientX,
                clientY: touch.clientY,
            });
        }
    }

    function handleTouchMove(event) {
        event.preventDefault();

        if (!state.touchStartedOverUI && state.isDrawing) {
            const touch = event.touches[0];
            updateLine({
                clientX: touch.clientX,
                clientY: touch.clientY,
            });
        }
    }

    function handleTouchEnd(event) {
        state.touchStartedOverUI = false;
        endLine();
    }

    function setupUI() {
        const clearBtn = createClearButton();
        document.body.appendChild(clearBtn);
        state.uiElements.push(clearBtn);

        const controls = createControlPanel();
        document.body.appendChild(controls.panel);
        state.uiElements.push(controls.panel);

        if (state.isMobile) {
            makeUIMobileFriendly();
        }
    }

    function makeUIMobileFriendly() {
        const clearBtn = document.querySelector('button');
        if (clearBtn) {
            clearBtn.style.fontSize = '64px';
            clearBtn.style.padding = '15px 20px';
            clearBtn.style.bottom = '25px';
            clearBtn.style.right = '25px';
        }

        const panel = document.querySelector('.control-panel');
        if (panel) {
            panel.style.width = '250px';
            panel.style.fontSize = '16px';
            panel.style.padding = '20px';
            panel.querySelector('.toggle-button').style.width = '30px';
            panel.querySelector('.toggle-button').style.height = '30px';
        }

        const sliderStyles = document.createElement('style');
        sliderStyles.textContent = `
            input[type=range]::-webkit-slider-thumb {
                width: 24px !important;
                height: 24px !important;
            }
            input[type=range]::-moz-range-thumb {
                width: 24px !important;
                height: 24px !important;
            }
            input[type=range] {
                height: 30px !important;
            }
        `;
        document.head.appendChild(sliderStyles);
    }

    function isOverUI(x, y) {
        for (const element of state.uiElements) {
            const rect = element.getBoundingClientRect();
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                return true;
            }
        }
        return false;
    }

    function createClearButton() {
        const btn = document.createElement('button');
        btn.textContent = 'X';
        Object.assign(btn.style, {
            position: 'fixed',
            bottom: '15px',
            right: '15px',
            background: 'transparent',
            color: 'white',
            fontSize: '48px',
            fontFamily: 'Roboto, Arial, sans-serif',
            fontWeight: '600',
            border: 'none',
            borderRadius: '50%',
            padding: '8px 10px',
            cursor: 'pointer',
            textTransform: 'none',
            letterSpacing: '0.5px',
            transition: 'transform 0.2s',
            zIndex: '1000',
        });

        btn.addEventListener('mouseover', () => {
            btn.style.transform = 'scale(1.2)';
        });

        btn.addEventListener('mouseout', () => {
            btn.style.transform = 'scale(1)';
        });

        btn.addEventListener('mousedown', () => {
            btn.style.transform = 'scale(0.95)';
        });

        btn.addEventListener('mouseup', () => {
            btn.style.transform = 'scale(1)';
        });

        btn.addEventListener('click', clearScene);

        btn.addEventListener('touchstart', () => {
            btn.style.transform = 'scale(0.95)';
        });

        btn.addEventListener('touchend', () => {
            btn.style.transform = 'scale(1)';
            clearScene();
        });

        return btn;
    }

    function createControlPanel() {
        const panel = document.createElement('div');
        panel.className = 'control-panel';

        const content = document.createElement('div');
        content.className = 'panel-content';
        panel.appendChild(content);

        const toggleButton = document.createElement('button');
        toggleButton.className = 'toggle-button';
        panel.appendChild(toggleButton);

        const style = document.createElement('style');
        style.textContent = `
            .control-panel {
                position: fixed;
                top: 15px;
                left: 15px;
                background: ${UI.PANEL_BACKGROUND};
                color: ${UI.TEXT_COLOR};
                padding: 12px;
                border-radius: 3px;
                box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                z-index: 1000;
                width: 200px;
                transition: all 0.3s ease;
                overflow: hidden;
                font-family: Roboto, Arial, sans-serif;
                opacity: 1;
            }
            
            .control-panel.collapsed {
                width: 30px;
                padding: 12px 0;
                cursor: pointer;
                background: none;
            }
            
            .panel-content {
                transition: opacity 0.3s ease;
            }
            
            .control-panel.collapsed .panel-content {
                opacity: 0;
                pointer-events: none;
            }
            
            .toggle-button {
                position: absolute;
                right: 5px;
                top: 50%;
                transform: translateY(-50%);
                background: none;
                border: none;
                color: ${UI.TEXT_COLOR};
                cursor: pointer;
                padding: 0;
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 1 !important;
            }
            
            .toggle-button::before {
                content: '❮';
                font-size: 16px;
                transition: transform 0.3s ease;
            }
            
            .control-panel.collapsed .toggle-button::before {
                transform: rotate(180deg);
            }
        `;
        document.head.appendChild(style);

        let isCollapsed = false;
        toggleButton.addEventListener('click', function () {
            isCollapsed = !isCollapsed;
            panel.classList.toggle('collapsed');
            if (!isCollapsed) {
                panel.style.pointerEvents = 'auto';
            }
        });

        panel.addEventListener('click', function (e) {
            if (isCollapsed && e.target === panel) {
                panel.classList.remove('collapsed');
                isCollapsed = false;
            }
        });

        panel.addEventListener('touchstart', function (e) {
            e.preventDefault();
            if (isCollapsed && e.target === panel) {
                panel.classList.remove('collapsed');
                isCollapsed = false;
            }
        });

        toggleButton.addEventListener('touchstart', function (e) {
            e.preventDefault();
            isCollapsed = !isCollapsed;
            panel.classList.toggle('collapsed');
            if (!isCollapsed) {
                panel.style.pointerEvents = 'auto';
            }
        });

        const fpsContainer = document.createElement('div');
        fpsContainer.textContent = 'FPS: --';
        Object.assign(fpsContainer.style, {
            marginBottom: '10px',
            fontSize: '12px',
            fontWeight: '600',
            color: UI.HIGHLIGHT_COLOR,
            background: 'rgba(0, 0, 0, 0.2)',
            padding: '5px',
            borderRadius: '3px',
            textAlign: 'center',
        });
        content.appendChild(fpsContainer);
        fpsState.fpsElement = fpsContainer;

        const controls = {
            speed: createSlider('Speed', 0.05, 2, params.particleSpeed, 0.01, (value) => {
                params.particleSpeed = parseFloat(value);
            }),
            size: createSlider('Size', 20, 80.0, params.particleSize, 5, (value) => {
                params.particleSize = parseFloat(value);
            }),
            spray: createSlider('Spray Width', 0.5, 5.0, params.sprayWidth, 0.5, (value) => {
                params.sprayWidth = parseFloat(value);
            }),
            density: createSlider('Density', 0.1, 10, params.particleDensity, 0.1, (value) => {
                params.particleDensity = parseFloat(value);
            }),
        };

        Object.values(controls).forEach((control) => content.appendChild(control));

        // --- Color Picker UI ---
        const colorContainer = document.createElement('div');
        colorContainer.style.marginBottom = '12px';

        // Color input (RGB square/wheel)
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = currentColor;
        colorInput.style.width = '100%';
        colorInput.style.height = '40px';
        colorInput.style.border = 'none';
        colorInput.style.background = 'none';
        colorInput.style.marginBottom = '6px';
        colorInput.style.cursor = 'pointer';

        // Hex input
        const hexInput = document.createElement('input');
        hexInput.type = 'text';
        hexInput.value = currentColor;
        hexInput.maxLength = 7;
        hexInput.style.width = '100%';
        hexInput.style.background = '#222';
        hexInput.style.color = '#fff';
        hexInput.style.border = '1px solid #444';
        hexInput.style.borderRadius = '2px';
        hexInput.style.padding = '4px 6px';
        hexInput.style.fontSize = '14px';

        // Sync color input and hex input
        function setColor(val) {
            if (!/^#[0-9a-fA-F]{6}$/.test(val)) return;
            currentColor = val;
            colorInput.value = val;
            hexInput.value = val;
            // Update material colors
            materials.line.color.set(val);
            materials.dot.color.set(val);
        }
        colorInput.addEventListener('input', (e) => setColor(e.target.value));
        hexInput.addEventListener('change', (e) => setColor(e.target.value));

        // Add to panel
        colorContainer.appendChild(colorInput);
        colorContainer.appendChild(hexInput);
        content.appendChild(colorContainer);

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

        window.addEventListener('touchstart', handleTouchStart, {
            passive: false,
        });
        window.addEventListener('touchmove', handleTouchMove, {
            passive: false,
        });
        window.addEventListener('touchend', handleTouchEnd);
        window.addEventListener('touchcancel', handleTouchEnd);

        window.addEventListener('resize', handleResize);
        window.addEventListener('orientationchange', handleResize);
    }

    function handleResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }

    function updateFPS(currentTime) {
        fpsState.frameCount++;

        if (currentTime - fpsState.lastFpsUpdate >= 500) {
            const timeDelta = currentTime - fpsState.lastFpsUpdate;
            const fps = Math.round((fpsState.frameCount * 1000) / timeDelta);

            fpsState.fps = fps;
            if (fpsState.fpsElement) {
                fpsState.fpsElement.textContent = `FPS: ${fps}`;
            }

            fpsState.frameCount = 0;
            fpsState.lastFpsUpdate = currentTime;
        }
    }

    function animate(time = 0) {
        requestAnimationFrame(animate);

        const now = performance.now();
        const elapsed = now - lastTime;

        if (elapsed >= FRAME_INTERVAL) {
            const delta = elapsed / 1000;
            lastTime = now - (elapsed % FRAME_INTERVAL);

            updateFPS(now);
            updateDots(delta);
            renderer.render(scene, camera);
        }
    }

    return {
        dispose: () => {
            window.removeEventListener('mousedown', startLine);
            window.removeEventListener('mousemove', updateLine);
            window.removeEventListener('mouseup', endLine);
            window.removeEventListener('touchstart', handleTouchStart);
            window.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchend', handleTouchEnd);
            window.removeEventListener('touchcancel', handleTouchEnd);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('orientationchange', handleResize);

            clearScene();

            for (const element of state.uiElements) {
                document.body.removeChild(element);
            }

            if (fpsState.fpsElement && fpsState.fpsElement.parentNode) {
                fpsState.fpsElement.parentNode.removeChild(fpsState.fpsElement);
            }

            document.body.removeChild(renderer.domElement);

            sphereGeometry.dispose();
            materials.dot.dispose();
            materials.line.dispose();
            renderer.dispose();
        },
    };
};
