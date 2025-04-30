import * as THREE from 'three';
export const createScene = () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );

    camera.position.z = 5;
    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '✕';
    Object.assign(clearBtn.style, {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        background: 'transparent',
        color: 'white',
        fontSize: '86px',
        width: 'auto',
        height: 'auto',
        border: 'none',
        padding: '0',
        cursor: 'pointer',
        zIndex: '1000',
    });
    document.body.appendChild(clearBtn);

    const lineMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff,
        linewidth: 2,
    });
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const point = new THREE.Vector3();
    let isDrawing = false;
    let currentLine;
    let currentLinePoints = [];

    const screenToWorld = (clientX, clientY) => {
        mouse.set(
            (clientX / window.innerWidth) * 2 - 1,
            -(clientY / window.innerHeight) * 2 + 1
        );
        raycaster.setFromCamera(mouse, camera);
        raycaster.ray.intersectPlane(planeZ, point);
        return point.clone();
    };

    const startLine = (event) => {
        isDrawing = true;
        const point = screenToWorld(event.clientX, event.clientY);
        currentLinePoints = [point, point.clone()];
        currentLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(currentLinePoints),
            lineMaterial
        );
        scene.add(currentLine);
    };

    const updateLine = (event) => {
        if (!isDrawing) return;
        currentLinePoints.push(screenToWorld(event.clientX, event.clientY));
        currentLine.geometry.dispose();
        currentLine.geometry = new THREE.BufferGeometry().setFromPoints(
            currentLinePoints
        );
    };

    const endLine = () => {
        isDrawing = false;
        currentLine = null;
        currentLinePoints = [];
    };

    const clearScene = () => {
        [...scene.children].forEach((object) => {
            if (object.geometry) object.geometry.dispose();
            if (object.material) object.material.dispose();
            scene.remove(object);
        });
    };

    clearBtn.addEventListener('click', clearScene);
    window.addEventListener('mousedown', startLine);
    window.addEventListener('mousemove', updateLine);
    window.addEventListener('mouseup', endLine);
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    function animate() {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
    }

    animate();
};
