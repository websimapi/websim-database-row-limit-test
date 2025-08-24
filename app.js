import React from 'react';
import { createRoot } from 'react-dom/client';
import { WebsimSocket, useQuery } from '@websim/use-query';

const App = () => {
    const collectionName = 'stress_test_row_v4'; // Use a versioned collection name

    const room = React.useMemo(() => {
        return new WebsimSocket({
            schema: {
                [collectionName]: {
                    id: "uuid", // Standard, auto-managed by WebsimSocket
                    value: "integer",
                    client_timestamp: "numeric" // Storing Date.now() result
                    // username and created_at are automatically added
                }
            }
        });
    }, [collectionName]); // collectionName is a const, so this memo runs once

    const testRowCollection = React.useMemo(() => room.collection(collectionName), [room, collectionName]);

    const [isRunning, setIsRunning] = React.useState(false);
    const [attemptedCount, setAttemptedCount] = React.useState(0);
    const [currentValue, setCurrentValue] = React.useState(0);
    const [delayMs, setDelayMs] = React.useState(10); // Initial delay
    const [lastError, setLastError] = React.useState(null);
    const [statusMessage, setStatusMessage] = React.useState("Idle. Click 'Start Test' to begin.");
    const [successfulLocalInserts, setSuccessfulLocalInserts] = React.useState(0);

    const timeoutRef = React.useRef(null);
    const isRunningRef = React.useRef(isRunning); 

    // Query for total row count - much more efficient than fetching all rows
    const { data: countData, loading: countLoading } = useQuery(
        room.query(`SELECT count(id) as total FROM public.${collectionName}`)
    );
    const confirmedCountInDB = countData?.[0]?.total || 0;

    // Query for the 5 most recent rows for display
    const { data: recentRowsData, loading: recentRowsLoading } = useQuery(
        room.query(
            `SELECT r.id, r.value, r.client_timestamp, r.created_at, u.username 
             FROM public.${collectionName} r 
             JOIN public.user u ON r.user_id = u.id 
             ORDER BY r.created_at DESC
             LIMIT 5`
        )
    );
    const recentRows = recentRowsData || [];

    const insertRowLogic = React.useCallback(async () => {
        setAttemptedCount(prev => prev + 1);
        const valueToInsert = currentValue;

        try {
            setStatusMessage(`Attempting: Value ${valueToInsert}, Delay: ${delayMs}ms`);
            await testRowCollection.create({ 
                value: valueToInsert, 
                client_timestamp: Date.now() 
            });
            setSuccessfulLocalInserts(prev => prev + 1);
            setCurrentValue(prev => prev + 1);
            setLastError(null);
            setStatusMessage(`Success: Value ${valueToInsert}. Next in ${delayMs}ms.`);
        } catch (error) {
            console.error(`Insertion error for value ${valueToInsert}:`, error);
            const errorMessage = error.message || String(error);
            setLastError(`Failed (val: ${valueToInsert}): ${errorMessage.substring(0,100)}`);
            const newDelay = Math.min(Math.floor(delayMs * 1.5) + 100, 10000);
            setDelayMs(newDelay);
            setStatusMessage(`Error: Value ${valueToInsert}. New delay: ${newDelay}ms. Retrying...`);
        }
    }, [currentValue, delayMs, testRowCollection, setAttemptedCount, setSuccessfulLocalInserts, setCurrentValue, setLastError, setDelayMs, setStatusMessage]);

    React.useEffect(() => {
        isRunningRef.current = isRunning;

        if (isRunning) {
            const runLoop = async () => {
                if (!isRunningRef.current) return; 
                await insertRowLogic();
                if (isRunningRef.current) { 
                    timeoutRef.current = setTimeout(runLoop, delayMs);
                }
            };
            
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(runLoop, delayMs);

        } else {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
            if (attemptedCount > 0) {
                setStatusMessage("Stopped. Click 'Start Test' to resume or 'Reset' for a new session.");
            } else {
                setStatusMessage("Idle. Click 'Start Test' to begin.");
            }
        }

        return () => { 
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            isRunningRef.current = false; 
        };
    }, [isRunning, delayMs, insertRowLogic, attemptedCount]);

    const handleStartTest = () => {
        setLastError(null);
        setDelayMs(1); 
        setIsRunning(true);
        setStatusMessage("Test started. Initializing first insert...");
    };

    const handleStopTest = () => {
        setIsRunning(false);
    };
    
    const handleResetClientState = () => {
        setIsRunning(false); 
        setCurrentValue(0);
        setAttemptedCount(0);
        setSuccessfulLocalInserts(0);
        setLastError(null);
        setDelayMs(10); 
        setStatusMessage("Client state reset. Database rows shown are current. Ready for a new test.");
    };

    return (
        <div>
            <h1>Database Stress Test</h1>
            <div className="button-group">
                <button onClick={handleStartTest} disabled={isRunning}>Start Test</button>
                <button onClick={handleStopTest} disabled={!isRunning}>Stop Test</button>
                <button onClick={handleResetClientState} disabled={isRunning}>Reset Client State & Counters</button>
            </div>

            <h2>Live Status & Stats</h2>
            <p><strong>Status:</strong> {statusMessage}</p>
            <div className="stats-grid">
                <div className="stat-item"><strong>Test Running:</strong> {isRunning ? "Yes" : "No"}</div>
                <div className="stat-item"><strong>Attempted Inserts:</strong> {attemptedCount}</div>
                <div className="stat-item"><strong>Succeeded (Client Ack):</strong> {successfulLocalInserts}</div>
                <div className="stat-item"><strong>Next Value to Insert:</strong> {currentValue}</div>
                <div className="stat-item"><strong>Current Delay:</strong> {delayMs} ms</div>
                <div className="stat-item"><strong>Collection:</strong> {collectionName}</div>
            </div>
            {lastError && <p className="error-message">Last Error: {lastError}</p>}
            
            <h2>Database Verification</h2>
            <p><strong>Total Confirmed Rows in DB: {countLoading ? 'Loading...' : confirmedCountInDB}</strong></p>
            <p><em>(Showing the 5 most recent rows from database. List updates in real-time.)</em></p>
            <ul>
                {recentRowsLoading ? (
                    <li>Loading database entries...</li>
                ) : recentRows.length === 0 ? (
                    <li>No rows found in the database for collection '{collectionName}'.</li>
                ) : (
                    recentRows.map(row => (
                        <li key={row.id}>
                            <strong>Value: {row.value}</strong> (ID: {row.id.substring(0,8)}...) <br />
                            Created: {new Date(row.created_at).toLocaleString()} by {row.username} <br />
                            Client Ts: {row.client_timestamp ? new Date(row.client_timestamp).toLocaleTimeString([], {hour12:false, minute:'2-digit', second:'2-digit', fractionalSecondDigits: 3}) : 'N/A'}
                        </li>
                    ))
                )}
            </ul>
            { !countLoading && confirmedCountInDB > 5 && <p>...and {confirmedCountInDB - 5} more rows not shown.</p>}
        </div>
    );
};

const root = createRoot(document.getElementById('root'));
root.render(<App />);