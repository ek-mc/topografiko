

function IsImageOk(img) {
    if (!img.complete) {
        return false;
    }


    if (img.naturalWidth === 0) {
        return false;
    }

    return true;
}
function createNorthArrowIMAGE() {
    var NorthArrowIMAGE = document.createElement('img');
    NorthArrowIMAGE.style.width = '50px';
    NorthArrowIMAGE.style.height = '50px';
    NorthArrowIMAGE.src = rootPath + 'images/DirectionArrow.png';
    NorthArrowCanvas = document.createElement('canvas');
    NorthArrowCanvas.style.width = '50px';
    NorthArrowCanvas.style.height = '50px';
    NorthArrowCanvas.ctx = NorthArrowCanvas.getContext('2d');
    NorthArrowCanvas.setAttribute('width', parseInt(NorthArrowCanvas.style.width.replace('px', '')) + '');
    NorthArrowCanvas.setAttribute('height', parseInt(NorthArrowCanvas.style.height.replace('px', '')) + '');
    NorthArrowCanvas.style.visibility = "visible";
    NorthArrowCanvas.style.zIndex = 90001;
    NorthArrowCanvas.onmouseover = NorthArrowCanvas.style.cursor = 'pointer';
    NorthArrowCanvas.image = NorthArrowIMAGE;
}

function rotateNorth(aa) {
    //NorthArrowCanvas
    if (IsImageOk(NorthArrowCanvas.image)) {
        NorthArrowCanvas.ctx.save(); //saves the state of canvas
        NorthArrowCanvas.ctx.clearRect(0, 0, NorthArrowCanvas.width, NorthArrowCanvas.height); //clear the canvas
        NorthArrowCanvas.ctx.translate(NorthArrowCanvas.width / 2, NorthArrowCanvas.height / 2); //let's translate //NorthArrowCanvas.image.width NorthArrowCanvas.image.height
        NorthArrowCanvas.ctx.rotate((-aa)); //increment the angle and rotate the image 
        NorthArrowCanvas.ctx.drawImage(NorthArrowCanvas.image, -NorthArrowCanvas.width / 2, -NorthArrowCanvas.height / 2, NorthArrowCanvas.width, NorthArrowCanvas.height); //draw the image ;)
        NorthArrowCanvas.ctx.restore(); //restore the state of canvas
    }
}



function before3DInit(map) {
    return false;
}

function CameraMoved(info) {

    document.getElementById('MapScaleDiv').innerHTML = 'ΥΨΟΜΕΤΡΟ: ' + Math.round(info[2]) + ' μέτρα';
}

function cameraMouseUp(args) {
    MyMap.RefreshInfoLayer();
}



function show3D() {
    if (mode == 'SPLIT_WINDOW') {
        endSplitWindow();
    }
    if (mode == 'SHARE_WINDOW') {
        endShareWindow();
    }
    if (mode == '3D') {
        end3D();
        MyMap1.Enable3D(false);
        return;
    }
    setStats(0, true);
    document.getElementById('a_3D').innerHTML = "2D";

    mode = '3D';
    var e = MyMap.MapExtents();
    var xc = (e.left + e.right) / 2;
    var yc = (e.top + e.bottom) / 2;
    if (!isMobile) {
        MyMap.HideToolbar();
    }
    MyMap.ClickToolbarItem('ToolPan');
    document.getElementById('currentBasemap').disabled = true;
    document.getElementById('cmdMashup').disabled = true;
    document.getElementById('currentOverlay').disabled = true;
    document.getElementById('currentStat').disabled = true;




    var C = document.getElementById('Canvas');

    if (C.clientWidth >= C.clientHeight) {
        KT__setClasses('Canvas', allCanvasClasses, ['mapLeft', 'mapHalfW', 'mapFullH']);
        KT__setClasses('Canvas1', allCanvasClasses, ['mapRight', 'mapHalfW', 'mapFullH']);
        KT__setClasses('sync3D', ['mapOff'], ['mapRight', 'mapBottom']);
        document.getElementById('sync3DButton').value = 'Μετάβαση ➔';
    } else {
        KT__setClasses('Canvas', allCanvasClasses, ['mapTop', 'mapFullW', 'mapHalfH']);
        KT__setClasses('Canvas1', allCanvasClasses, ['mapBottom', 'mapFullW', 'mapHalfH']);
        KT__setClasses('sync3D', ['mapOff'], ['mapRight', 'mapBottom']);
        document.getElementById('sync3DButton').value = 'Μετάβαση ↓';
    }

    MyMap1.ChangeBasemap(MyMap.GetBasemap(), 'jpg');
    MyMap1.SetScale(MyMap.MapScale());
    MyMap1.PanTo(xc, yc);
    MyMap.FullRefresh();
    MyMap1.FullRefresh();
    MyMap1.Enable3D();
    //MyMap1.GL.addShapes(MyMap.GetShapes(false));
    var Z = MyMap1.GL.getElevationAtXY(xc, yc);
    if (Z == null || Z == undefined) {
        Z = 100;
    }
    MyMap1.GL.CenterAt(xc, yc - 100, Z);
    MyMap1.GL.setLookAt(xc, yc, Z - 10);
    waitForZAndDrape(xc, yc, 1);
    rotateNorth(0);
    set3DPositionIcon(xc, yc);
}



function waitForZAndDrape(cx, cy, iteration) {
    if (MyMap1.GL) {
        var Z = MyMap1.GL.getElevationAtXY(cx, cy);
        if (Z == null || Z == undefined) {
            if (iteration >= 50) {
                return;
            }
            setTimeout(function () { waitForZAndDrape(cx, cy, iteration++); }, 500);
            return;
        }
        MyMap1.GL.CenterAt(cx, cy - 100, Z);
        MyMap1.GL.setLookAt(cx, cy, Z - 10);
    }
}

function set3DPositionIcon(x, y) {
    MyMap.RemoveAllCustomObjects();
    var MyObj = new KT.KTWebMap.CustomObject(NorthArrowCanvas, x, y);
    MyMap.AddCustomObject(MyObj);
    MyMap.RefreshOverlays();
}
var isDescending = false;
function Descent(x1,y1,z1, x2,y2,z2) {
    if (!isDescending) {
        var Z = MyMap1.GL.getElevationAtXY(x1, y1);
        if (Z != null) {
            Z += 20;
            var dZ = Z - z1;
            isDescending = true;
            MyMap1.GL.setCenterAtAndLookAt(x1, y1, Z, x2, y2, z2 + dZ, 300);
        } else {
            setTimeout(function () { Descent(x1, y1, z1, x2, y2, z2); }, 300);
        }
    } else {
        isDescending = false;
    }
}

function cameraMoved3D(args) {
    var x1 = args[0];
    var y1 = args[1];
    var z1 = args[2];
    var AA = -args[3];
    var x2 = args[4];
    var y2 = args[5];
    var z2 = args[6];
    rotateNorth(AA);
    set3DPositionIcon(x1, y1);
    var reason = args[7];
    var isAnimation = args[8];
    if ((reason.indexOf('Code.') == -1) && (reason.indexOf('Auto.Z') == -1)) {
        preventMoveOfMap1 = true;
        UserHasMoved3DOnce = true;


        MyMap.PanTo(x1, y1);
        MyMap.RefreshOverlays();
        preventMoveOfMap1 = false;
    } else if (reason.indexOf('Code.') != -1 && isAnimation == true) {
        Descent(x1, y1, z1, x2, y2, z2);
    }
}

function before3DDestroyed(args) {
    var xc = args[1];
    var yc = args[2];
    end3D(xc, yc);
}

function end3D(xc, yc) {
    document.getElementById('a_3D').innerHTML = "3D";
    mode = 'NORMAL';
    KT__setClasses('Canvas', allCanvasClasses, ['mapLeft', 'mapTop', 'mapFullW', 'mapFullH']);
    KT__setClasses('Canvas1', allCanvasClasses, ['mapOff']);
    KT__setClasses('sync3D', [], ['mapOff']);
    document.getElementById('currentBasemap').disabled = false;
    document.getElementById('cmdMashup').disabled = false;
    document.getElementById('currentOverlay').disabled = false;
    document.getElementById('currentStat').disabled = false;
    if (!isMobile) {
        MyMap.ShowToolbar();
    }
    MyMap.PanTo(xc, yc);
    MyMap.RemoveAllCustomObjects();
    setOverlays(currentOverlay);
    MyMap.FullRefresh();
}


function after3DInit(args) {
    var map = args[0];
    map.GL.setVisibility('flyover', false);
    map.GL.setVisibility('northArrow', true);
    map.GL.setVisibility('verticalAngle', true);
    map.GL.setVisibility('returnButton', false);
}

function sync3D() {
    isDescending = false;
    var e = MyMap.MapExtents();
    var xc = (e.left + e.right) / 2;
    var yc = (e.top + e.bottom) / 2;
    var coords3D = MyMap1.GL.getCameraPosition();
    var z = Math.min(Math.max(coords3D[2], 1500), 3000);
    MyMap1.GL.setCenterAtAndLookAt(xc - 100, yc - 100, z, xc, yc, z, 600);
}


function show3DFlight(id) {
    var Meteora1 = {};
    Meteora1.Xs = [298219, 297889, 297677, 297412, 297307, 297095, 297002, 296923, 296817, 296738, 296777, 296817, 296976, 297108, 297307, 297452, 297690, 297796, 297875, 297915, 297902, 297796, 297690, 297571, 297492, 297227];
    Meteora1.Ys = [4397001, 4397133, 4397226, 4397332, 4397398, 4397530, 4397623, 4397702, 4397861, 4398099, 4398350, 4398482, 4398588, 4398628, 4398641, 4398707, 4398813, 4398972, 4399210, 4399356, 4399554, 4399726, 4399872, 4399991, 4400030, 4400163];
    Meteora1.xC = Meteora1.Xs[0];
    Meteora1.yC = Meteora1.Ys[0];
    Meteora1.zC = 800;
    Meteora1.xL = 296551;
    Meteora1.yL = 4398410;
    Meteora1.zL = 600;
    Meteora1.speed = 3;
    Meteora1.lockLookAt = true;
    Meteora1.followPath = false;
    Meteora1.lookAtStep = -1;

    var Olympos = {};
    Olympos.Xs = [365717, 361828, 360082, 358574, 358018, 358574, 359050, 360240, 361828, 364050, 366194, 368019];
    Olympos.Ys = [4427899, 4429487, 4430916, 4433059, 4434964, 4436869, 4438694, 4440520, 4442266, 4443377, 4444092, 4444409];
    Olympos.xC = Olympos.Xs[0];
    Olympos.yC = Olympos.Ys[0];
    Olympos.zC = 3900;
    Olympos.xL = 361113;
    Olympos.yL = 4437821;
    Olympos.zL = 500;
    Olympos.speed = 10;
    Olympos.lockLookAt = true;
    Olympos.followPath = false;
    Olympos.lookAtStep = -1;

    var samaria1 = {};
    samaria1.Xs = [497152, 496295, 495911, 495805, 496003, 496149, 496321, 496281, 496427, 496678, 496916, 496982, 496916, 496691, 496546, 496493];
    samaria1.Ys = [3906455, 3906013, 3905854, 3905602, 3904967, 3904610, 3903856, 3902732, 3902441, 3901991, 3901515, 3900919, 3900271, 3899610, 3898631, 3898234];
    samaria1.xC = samaria1.Xs[0];
    samaria1.yC = samaria1.Ys[0];
    samaria1.zC = 700;
    samaria1.xL = samaria1.Xs[1];
    samaria1.yL = samaria1.Ys[1];
    samaria1.zL = -100;
    samaria1.speed = 4;
    samaria1.lookAtStep = -1;
    samaria1.followPath = 2;
    samaria1.lockLookAt = false;

    var a = null;
    switch (id) {
        case 0: //meteora
            {
                a = Meteora1;
            }
            break;
        case 1: //olympos
            {
                a = Olympos;
            }
            break;
        case 2: //samaria
            {
                a = samaria1;
            }
            break;
    }
    if (a) {
        var shape = Serialization.CreateShapeFromCoordinates(a.Xs, a.Ys, '', '', 1);
        if (MyMap.GL == null) {
            MyMap.CenterAt(a.xC, a.yC);
            MyMap.Enable3D(true, false);
        }
        MyMap.GL.clearAnimations();
        MyMap.GL.setCenterAtAndLookAt(a.xC, a.yC, a.zC, a.xL, a.yL, a.zL, a.lookAtStep);
        MyMap.GL.addAnimationFromShape(shape, a.speed, a.followPath, -1, null, function (o) { MyMap.Enable3D(false); MyMap.ClickToolbarItem('ToolPan'); }, a.lockLookAt);
    }


}