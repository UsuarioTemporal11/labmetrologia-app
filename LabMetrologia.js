import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  StyleSheet,
  Dimensions,
  FlatList,
  Modal,
  Picker,
} from 'react-native';
import BluetoothSerial from 'react-native-bluetooth-serial-next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

const { width, height } = Dimensions.get('window');

const LabMetrologia = () => {
  // ============= ESTADOS =============
  const [pantalla, setPantalla] = useState('inicio'); // 'inicio', 'control', 'historial', 'reporte'
  const [bluetoothConnected, setBluetoothConnected] = useState(false);
  const [deviceAddress, setDeviceAddress] = useState(null);
  const [relojPatron, setRelojPatron] = useState('00:00:00.000');
  const [ensayoActivo, setEnsayoActivo] = useState(false);
  const [puntosDisparo, setPuntosDisparo] = useState([]);
  const [inicioEnsayo, setInicioEnsayo] = useState(null);
  const [finalEnsayo, setFinalEnsayo] = useState(null);
  const [historialEnsayos, setHistorialEnsayos] = useState([]);
  const [numCronometrosACalibar, setNumCronometrosACalibar] = useState(3);
  const [modalFormularioVisible, setModalFormularioVisible] = useState(false);
  
  // Form PDF
  const [encargado, setEncargado] = useState('');
  const [cronometroPatron, setCronometroPatron] = useState('');
  const [lecturasCronometrosExternos, setLecturasCronometrosExternos] = useState(
    Array(9).fill('')
  );

  // Tiempos preestablecidos (en segundos)
  const TIEMPOS_PREESTABLECIDOS = [
    { label: '30s', segundos: 30 },
    { label: '1m', segundos: 60 },
    { label: '10m', segundos: 600 },
    { label: '30m', segundos: 1800 },
    { label: '1h', segundos: 3600 },
    { label: '2h', segundos: 7200 },
    { label: '3h', segundos: 10800 },
    { label: '5h', segundos: 18000 },
    { label: '8h', segundos: 28800 },
    { label: '9h', segundos: 32400 },
  ];

  // ============= BLUETOOTH =============
  useEffect(() => {
    inicializarBluetooth();
    cargarHistorialEnsayos();
    return () => desconectarBluetooth();
  }, []);

  const inicializarBluetooth = async () => {
    try {
      const enabled = await BluetoothSerial.isEnabled();
      if (!enabled) {
        Alert.alert('Activa Bluetooth', 'Por favor activa el Bluetooth del dispositivo');
        return;
      }
    } catch (err) {
      console.log('Error: ', err);
    }
  };

  const conectarBluetooth = async () => {
    try {
      const devices = await BluetoothSerial.list();
      if (devices.length === 0) {
        Alert.alert('Sin dispositivos', 'No se encontraron dispositivos Bluetooth emparejados');
        return;
      }

      // Busca HC-06
      const hc06 = devices.find(d => d.name.includes('HC-06') || d.name.includes('hc-06'));
      if (!hc06) {
        Alert.alert('HC-06 no encontrado', 'Asegúrate de haber emparejado el HC-06');
        return;
      }

      await BluetoothSerial.connect(hc06.id);
      setDeviceAddress(hc06.id);
      setBluetoothConnected(true);
      escucharBluetooth();
    } catch (err) {
      Alert.alert('Error de conexión', err.message);
    }
  };

  const escucharBluetooth = async () => {
    try {
      BluetoothSerial.onDataReceived((data) => {
        const texto = data.data.trim();
        if (texto.match(/^\d{2}:\d{2}:\d{2}\.\d{3}$/)) {
          setRelojPatron(texto);
        }
      });
    } catch (err) {
      console.log('Error escuchando: ', err);
    }
  };

  const desconectarBluetooth = async () => {
    try {
      if (bluetoothConnected) {
        await BluetoothSerial.disconnect();
        setBluetoothConnected(false);
      }
    } catch (err) {
      console.log('Error desconectando: ', err);
    }
  };

  const enviarComando = async (comando) => {
    try {
      if (!bluetoothConnected) {
        Alert.alert('No conectado', 'Conecta primero el Bluetooth');
        return;
      }
      await BluetoothSerial.write(comando + '\n');
    } catch (err) {
      Alert.alert('Error enviando comando', err.message);
    }
  };

  // ============= CONTROL DE ENSAYO =============
  const iniciarEnsayo = async (tiempoSegundos) => {
    const tiempoFormato = formatearTiempoDesdeSegundos(tiempoSegundos);
    await enviarComando(tiempoFormato);
    await enviarComando('START');
    
    setEnsayoActivo(true);
    setInicioEnsayo(new Date());
    setFinalEnsayo(null);
    setPuntosDisparo([]);
  };

  const registrarPunto = () => {
    if (!ensayoActivo) return;

    const punto = {
      numero: puntosDisparo.length + 1,
      horaPatron: relojPatron,
      timestamp: new Date(),
    };

    const nuevosPuntos = [...puntosDisparo, punto];
    setPuntosDisparo(nuevosPuntos);

    // Si es el primer punto, registra inicio
    if (nuevosPuntos.length === 1) {
      setInicioEnsayo(new Date());
    }

    // Registra final (esto se actualiza con cada punto, el último será el final)
    setFinalEnsayo(new Date());
  };

  const finalizarEnsayo = () => {
    if (puntosDisparo.length === 0) {
      Alert.alert('Sin puntos', 'Debes registrar al menos un punto antes de finalizar');
      return;
    }

    setEnsayoActivo(false);
    setModalFormularioVisible(true);
  };

  const guardarEnsayo = async () => {
    const ensayo = {
      id: Date.now(),
      inicioEnsayo,
      finalEnsayo,
      puntosDisparo,
      encargado,
      cronometroPatron,
      numCronometrosACalibar,
      lecturasCronometrosExternos: lecturasCronometrosExternos.slice(0, numCronometrosACalibar),
    };

    const nuevosEnsayos = [...historialEnsayos, ensayo];
    setHistorialEnsayos(nuevosEnsayos);
    await AsyncStorage.setItem('historialEnsayos', JSON.stringify(nuevosEnsayos));

    // Limpiar formulario
    setEncargado('');
    setCronometroPatron('');
    setLecturasCronometrosExternos(Array(9).fill(''));
    setModalFormularioVisible(false);
    setPuntosDisparo([]);

    Alert.alert('Éxito', 'Ensayo guardado correctamente');
  };

  const resetearEnsayo = async () => {
    await enviarComando('RESET');
    setEnsayoActivo(false);
    setPuntosDisparo([]);
    setInicioEnsayo(null);
    setFinalEnsayo(null);
    setRelojPatron('00:00:00.000');
  };

  // ============= ALMACENAMIENTO =============
  const cargarHistorialEnsayos = async () => {
    try {
      const datos = await AsyncStorage.getItem('historialEnsayos');
      if (datos) {
        setHistorialEnsayos(JSON.parse(datos));
      }
    } catch (err) {
      console.log('Error cargando historial: ', err);
    }
  };

  const eliminarEnsayo = async (id) => {
    Alert.alert(
      'Confirmar eliminación',
      '¿Estás seguro que deseas eliminar este ensayo?',
      [
        { text: 'Cancelar', onPress: () => {} },
        {
          text: 'Eliminar',
          onPress: async () => {
            const nuevosEnsayos = historialEnsayos.filter(e => e.id !== id);
            setHistorialEnsayos(nuevosEnsayos);
            await AsyncStorage.setItem('historialEnsayos', JSON.stringify(nuevosEnsayos));
          },
        },
      ]
    );
  };

  // ============= GENERACIÓN PDF =============
  const generarPDF = async (ensayo) => {
    let puntosHTML = ensayo.puntosDisparo
      .map(
        (p, i) =>
          `<tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${p.numero}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${p.horaPatron}</td>
      </tr>`
      )
      .join('');

    let cronometrosHTML = '';
    for (let i = 0; i < ensayo.numCronometrosACalibar; i++) {
      cronometrosHTML += `
        <p><strong>Cronómetro ${i + 1} a Calibrar:</strong> ${
        ensayo.lecturasCronometrosExternos[i] || 'No registrado'
      }</p>
      `;
    }

    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body {
              font-family: 'Helvetica', 'Arial', sans-serif;
              background-color: #f5f5f5;
              color: #333;
              line-height: 1.6;
            }
            .container {
              max-width: 800px;
              margin: 0 auto;
              padding: 30px;
              background: white;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .header {
              text-align: center;
              border-bottom: 3px solid #1a3a52;
              padding-bottom: 20px;
              margin-bottom: 30px;
            }
            .header h1 {
              margin: 0;
              color: #1a3a52;
              font-size: 28px;
              font-weight: bold;
            }
            .header p {
              margin: 5px 0 0 0;
              color: #666;
              font-size: 12px;
            }
            .section {
              margin-bottom: 25px;
            }
            .section-title {
              background-color: #2a5a7a;
              color: white;
              padding: 10px 15px;
              border-radius: 4px;
              font-weight: bold;
              margin-bottom: 15px;
            }
            .info-row {
              display: flex;
              margin-bottom: 10px;
            }
            .info-label {
              font-weight: bold;
              width: 40%;
              color: #1a3a52;
            }
            .info-value {
              width: 60%;
              color: #555;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
            }
            table thead {
              background-color: #ecf0f1;
              border-bottom: 2px solid #1a3a52;
            }
            table th {
              padding: 12px;
              text-align: left;
              font-weight: bold;
              color: #1a3a52;
            }
            table td {
              padding: 10px;
              border-bottom: 1px solid #ddd;
            }
            .footer {
              text-align: center;
              font-size: 11px;
              color: #999;
              margin-top: 40px;
              padding-top: 20px;
              border-top: 1px solid #ddd;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>REPORTE DE CALIBRACIÓN METROLÓGICA</h1>
              <p>Sistema Lab Metrología - Ensayo de Sincronización de Cronómetros</p>
            </div>

            <div class="section">
              <div class="section-title">INFORMACIÓN DEL ENSAYO</div>
              <div class="info-row">
                <div class="info-label">Encargado:</div>
                <div class="info-value">${ensayo.encargado || 'No registrado'}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Cronómetro Patrón:</div>
                <div class="info-value">${ensayo.cronometroPatron || 'No especificado'}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Cantidad de Cronómetros a Calibrar:</div>
                <div class="info-value">${ensayo.numCronometrosACalibar}</div>
              </div>
            </div>

            <div class="section">
              <div class="section-title">FECHAS Y HORAS</div>
              <div class="info-row">
                <div class="info-label">Inicio de Ensayo:</div>
                <div class="info-value">${ensayo.inicioEnsayo.toLocaleString('es-ES')}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Final de Ensayo:</div>
                <div class="info-value">${ensayo.finalEnsayo.toLocaleString('es-ES')}</div>
              </div>
            </div>

            <div class="section">
              <div class="section-title">PUNTOS CALIBRADOS</div>
              <table>
                <thead>
                  <tr>
                    <th>Punto</th>
                    <th>Reloj Patrón (HH:MM:SS.mmm)</th>
                  </tr>
                </thead>
                <tbody>
                  ${puntosHTML}
                </tbody>
              </table>
            </div>

            <div class="section">
              <div class="section-title">LECTURAS DE CRONÓMETROS A CALIBRAR</div>
              ${cronometrosHTML}
            </div>

            <div class="footer">
              <p>Reporte generado automáticamente por Lab Metrología</p>
              <p>Fecha de generación: ${new Date().toLocaleString('es-ES')}</p>
            </div>
          </div>
        </body>
      </html>
    `;

    try {
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri);
    } catch (err) {
      Alert.alert('Error', 'No se pudo generar el PDF: ' + err.message);
    }
  };

  // ============= FUNCIONES AUXILIARES =============
  const formatearTiempoDesdeSegundos = (segundos) => {
    const horas = Math.floor(segundos / 3600);
    const minutos = Math.floor((segundos % 3600) / 60);
    const segs = segundos % 60;
    return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}:${String(segs).padStart(2, '0')}`;
  };

  // ============= PANTALLAS =============

  // PANTALLA INICIO
  const PantallaInicio = () => (
    <View style={styles.pantalla}>
      <View style={styles.headerPrincipal}>
        <Text style={styles.tituloPrincipal}>Lab Metrología</Text>
        <Text style={styles.subtituloPrincipal}>Sistema de Calibración de Cronómetros</Text>
      </View>

      <View style={styles.contenedor}>
        {bluetoothConnected ? (
          <View style={styles.estadoConectado}>
            <Text style={styles.textoConectado}>✓ Conectado a HC-06</Text>
            <TouchableOpacity
              style={styles.botonSecundario}
              onPress={desconectarBluetooth}
            >
              <Text style={styles.textoBoton}>Desconectar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.botonPrincipal}
            onPress={conectarBluetooth}
          >
            <Text style={styles.textoBotonPrincipal}>Conectar Bluetooth</Text>
          </TouchableOpacity>
        )}

        <View style={styles.gridBotones}>
          <TouchableOpacity
            style={[styles.botonMenu, { opacity: bluetoothConnected ? 1 : 0.5 }]}
            onPress={() => bluetoothConnected && setPantalla('control')}
            disabled={!bluetoothConnected}
          >
            <Text style={styles.textoBotonMenu}>Control</Text>
            <Text style={styles.iconoBotonMenu}>⚙️</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.botonMenu}
            onPress={() => setPantalla('historial')}
          >
            <Text style={styles.textoBotonMenu}>Historial</Text>
            <Text style={styles.iconoBotonMenu}>📋</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  // PANTALLA CONTROL
  const PantallaControl = () => (
    <View style={styles.pantalla}>
      <View style={styles.headerControl}>
        <TouchableOpacity onPress={() => setPantalla('inicio')}>
          <Text style={styles.botonVolver}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.tituloControl}>Control de Ensayo</Text>
      </View>

      <ScrollView style={styles.contenedor}>
        {/* RELOJ PATRÓN */}
        <View style={styles.relojPatronContainer}>
          <Text style={styles.etiquetaReloj}>RELOJ DE REFERENCIA</Text>
          <Text style={styles.displayReloj}>{relojPatron}</Text>
        </View>

        {/* BOTONES DE TIEMPO */}
        <View style={styles.tiemposGrid}>
          {TIEMPOS_PREESTABLECIDOS.map((t, idx) => (
            <TouchableOpacity
              key={idx}
              style={[styles.botonTiempo, ensayoActivo && styles.botonTiempoInactivo]}
              onPress={() => !ensayoActivo && iniciarEnsayo(t.segundos)}
              disabled={ensayoActivo}
            >
              <Text style={styles.textoBotonTiempo}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* CONTROLES DE ENSAYO */}
        <View style={styles.controlesEnsayo}>
          <TouchableOpacity
            style={[styles.botonAccion, styles.botonStart, !ensayoActivo && styles.botonInactivo]}
            onPress={registrarPunto}
            disabled={!ensayoActivo}
          >
            <Text style={styles.textoBotonAccion}>REGISTRAR PUNTO</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.botonAccion, styles.botonFinish, !ensayoActivo && styles.botonInactivo]}
            onPress={finalizarEnsayo}
            disabled={!ensayoActivo}
          >
            <Text style={styles.textoBotonAccion}>FINALIZAR ENSAYO</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.botonAccion, styles.botonReset]}
            onPress={resetearEnsayo}
          >
            <Text style={styles.textoBotonAccion}>RESET</Text>
          </TouchableOpacity>
        </View>

        {/* LISTA DE PUNTOS */}
        {puntosDisparo.length > 0 && (
          <View style={styles.puntosContainer}>
            <Text style={styles.tituloPuntos}>PUNTOS REGISTRADOS</Text>
            {puntosDisparo.map((p, idx) => (
              <View key={idx} style={styles.filaPoint}>
                <Text style={styles.numeroPunto}>Punto {p.numero}</Text>
                <Text style={styles.horaPunto}>{p.horaPatron}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* MODAL FORMULARIO */}
      <Modal visible={modalFormularioVisible} animationType="slide">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitulo}>Datos del Ensayo</Text>
            <TouchableOpacity onPress={() => setModalFormularioVisible(false)}>
              <Text style={styles.cerrarModal}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContenido}>
            {/* Selector de cronómetros a calibrar */}
            <View style={styles.formGroup}>
              <Text style={styles.labelForm}>Cronómetros a Calibrar</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={numCronometrosACalibar}
                  onValueChange={(value) => setNumCronometrosACalibar(value)}
                >
                  {[3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <Picker.Item key={n} label={`${n} cronómetros`} value={n} />
                  ))}
                </Picker>
              </View>
            </View>

            {/* Encargado */}
            <View style={styles.formGroup}>
              <Text style={styles.labelForm}>Encargado (Opcional)</Text>
              <TextInput
                style={styles.input}
                placeholder="Nombre del encargado"
                value={encargado}
                onChangeText={setEncargado}
              />
            </View>

            {/* Cronómetro Patrón */}
            <View style={styles.formGroup}>
              <Text style={styles.labelForm}>Cronómetro Patrón (Opcional)</Text>
              <TextInput
                style={styles.input}
                placeholder="Marca/Modelo del cronómetro patrón"
                value={cronometroPatron}
                onChangeText={setCronometroPatron}
              />
            </View>

            {/* Lecturas de cronómetros */}
            <Text style={styles.labelForm}>Lecturas de Cronómetros a Calibrar (Opcional)</Text>
            {Array.from({ length: numCronometrosACalibar }).map((_, i) => (
              <View key={i} style={styles.formGroup}>
                <TextInput
                  style={styles.input}
                  placeholder={`Cronómetro ${i + 1}`}
                  value={lecturasCronometrosExternos[i]}
                  onChangeText={(text) => {
                    const nuevasLecturas = [...lecturasCronometrosExternos];
                    nuevasLecturas[i] = text;
                    setLecturasCronometrosExternos(nuevasLecturas);
                  }}
                />
              </View>
            ))}

            {/* Botones */}
            <View style={styles.botonesModal}>
              <TouchableOpacity
                style={[styles.botonAccion, styles.botonSave]}
                onPress={guardarEnsayo}
              >
                <Text style={styles.textoBotonAccion}>GUARDAR ENSAYO</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.botonAccion, styles.botonCancel]}
                onPress={() => setModalFormularioVisible(false)}
              >
                <Text style={styles.textoBotonAccion}>CANCELAR</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );

  // PANTALLA HISTORIAL
  const PantallaHistorial = () => (
    <View style={styles.pantalla}>
      <View style={styles.headerControl}>
        <TouchableOpacity onPress={() => setPantalla('inicio')}>
          <Text style={styles.botonVolver}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.tituloControl}>Historial de Ensayos</Text>
      </View>

      <FlatList
        data={historialEnsayos}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listaHistorial}
        renderItem={({ item }) => (
          <View style={styles.itemHistorial}>
            <View style={styles.itemHeader}>
              <Text style={styles.itemFecha}>
                {new Date(item.inicioEnsayo).toLocaleDateString('es-ES')} -{' '}
                {item.puntosDisparo.length} puntos
              </Text>
            </View>
            <View style={styles.itemDetalles}>
              <Text style={styles.detalle}>
                <Text style={styles.etiquetaDetalle}>Encargado:</Text> {item.encargado || 'N/A'}
              </Text>
              <Text style={styles.detalle}>
                <Text style={styles.etiquetaDetalle}>Patrón:</Text> {item.cronometroPatron || 'N/A'}
              </Text>
              <Text style={styles.detalle}>
                <Text style={styles.etiquetaDetalle}>Cronómetros:</Text> {item.numCronometrosACalibar}
              </Text>
            </View>
            <View style={styles.itemBotones}>
              <TouchableOpacity
                style={[styles.botonAccion, styles.botonSmall, styles.botonPDF]}
                onPress={() => generarPDF(item)}
              >
                <Text style={styles.textoBotonSmall}>PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.botonAccion, styles.botonSmall, styles.botonDelete]}
                onPress={() => eliminarEnsayo(item.id)}
              >
                <Text style={styles.textoBotonSmall}>Eliminar</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );

  // ============= RENDER PRINCIPAL =============
  return (
    <View style={styles.appContainer}>
      {pantalla === 'inicio' && <PantallaInicio />}
      {pantalla === 'control' && <PantallaControl />}
      {pantalla === 'historial' && <PantallaHistorial />}
    </View>
  );
};

// ============= ESTILOS =============
const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  pantalla: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },

  // HEADER
  headerPrincipal: {
    backgroundColor: '#1a3a52',
    paddingTop: 50,
    paddingBottom: 30,
    paddingHorizontal: 20,
    borderBottomWidth: 3,
    borderBottomColor: '#2a5a7a',
  },
  tituloPrincipal: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtituloPrincipal: {
    fontSize: 14,
    color: '#b0c4de',
  },

  headerControl: {
    backgroundColor: '#2a5a7a',
    paddingTop: 40,
    paddingBottom: 15,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  botonVolver: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  tituloControl: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },

  // CONTENEDOR
  contenedor: {
    flex: 1,
    padding: 20,
  },

  // BOTONES
  botonPrincipal: {
    backgroundColor: '#2a5a7a',
    paddingVertical: 16,
    paddingHorizontal: 30,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 30,
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  textoBotonPrincipal: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },

  estadoConectado: {
    backgroundColor: '#d4edda',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#28a745',
  },
  textoConectado: {
    color: '#155724',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  botonSecundario: {
    backgroundColor: '#dc3545',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
    alignItems: 'center',
  },

  gridBotones: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 15,
  },
  botonMenu: {
    flex: 1,
    backgroundColor: '#ecf0f1',
    padding: 20,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#bdc3c7',
  },
  textoBotonMenu: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 10,
  },
  iconoBotonMenu: {
    fontSize: 32,
  },

  // RELOJ
  relojPatronContainer: {
    backgroundColor: '#1a3a52',
    padding: 25,
    borderRadius: 12,
    marginBottom: 30,
    alignItems: 'center',
    elevation: 8,
  },
  etiquetaReloj: {
    color: '#b0c4de',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 10,
    letterSpacing: 1,
  },
  displayReloj: {
    color: '#fff',
    fontSize: 48,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    letterSpacing: 2,
  },

  // TIEMPOS
  tiemposGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 10,
  },
  botonTiempo: {
    width: '23%',
    backgroundColor: '#2a5a7a',
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
    elevation: 3,
  },
  botonTiempoInactivo: {
    opacity: 0.5,
  },
  textoBotonTiempo: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },

  // CONTROLES
  controlesEnsayo: {
    marginBottom: 30,
    gap: 10,
  },
  botonAccion: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 6,
    alignItems: 'center',
    elevation: 4,
  },
  botonStart: {
    backgroundColor: '#28a745',
  },
  botonFinish: {
    backgroundColor: '#ffc107',
  },
  botonReset: {
    backgroundColor: '#dc3545',
  },
  botonSave: {
    backgroundColor: '#28a745',
  },
  botonCancel: {
    backgroundColor: '#6c757d',
  },
  botonDelete: {
    backgroundColor: '#dc3545',
  },
  botonPDF: {
    backgroundColor: '#007bff',
  },
  botonInactivo: {
    opacity: 0.5,
  },
  botonSmall: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    flex: 1,
  },
  textoBotonAccion: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  textoBotonSmall: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  textoBoton: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },

  // PUNTOS
  puntosContainer: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 8,
    marginBottom: 30,
    borderLeftWidth: 4,
    borderLeftColor: '#2a5a7a',
  },
  tituloPuntos: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2a5a7a',
    marginBottom: 15,
  },
  filaPoint: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ecf0f1',
  },
  numeroPunto: {
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  horaPunto: {
    color: '#7f8c8d',
    fontFamily: 'monospace',
  },

  // MODAL
  modalContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    marginTop: 40,
  },
  modalHeader: {
    backgroundColor: '#1a3a52',
    paddingVertical: 15,
    paddingHorizontal: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitulo: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  cerrarModal: {
    fontSize: 24,
    color: '#fff',
  },
  modalContenido: {
    padding: 20,
  },

  // FORMULARIO
  formGroup: {
    marginBottom: 20,
  },
  labelForm: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#bdc3c7',
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#2c3e50',
  },
  pickerContainer: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#bdc3c7',
    borderRadius: 6,
    overflow: 'hidden',
  },
  botonesModal: {
    marginTop: 30,
    gap: 10,
    marginBottom: 30,
  },

  // HISTORIAL
  listaHistorial: {
    padding: 20,
    paddingBottom: 40,
  },
  itemHistorial: {
    backgroundColor: '#fff',
    padding: 15,
    marginBottom: 15,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#2a5a7a',
    elevation: 2,
  },
  itemHeader: {
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ecf0f1',
    paddingBottom: 10,
  },
  itemFecha: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2a5a7a',
  },
  itemDetalles: {
    marginBottom: 12,
  },
  detalle: {
    fontSize: 12,
    color: '#555',
    marginBottom: 6,
  },
  etiquetaDetalle: {
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  itemBotones: {
    flexDirection: 'row',
    gap: 10,
  },
});

export default LabMetrologia;
